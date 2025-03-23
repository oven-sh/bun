const std = @import("std");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const encoder = @import("encoder.zig");
const ImageFormat = encoder.ImageFormat;
const EncodingOptions = encoder.EncodingOptions;
const lanczos3 = @import("lanczos3.zig");
const bilinear = @import("bilinear.zig");

/// A chunk of image data for streaming processing
pub const ImageChunk = struct {
    /// Raw pixel data
    data: []u8,
    
    /// Starting row in the image
    start_row: usize,
    
    /// Number of rows in this chunk
    rows: usize,
    
    /// Image width (pixels per row)
    width: usize,
    
    /// Pixel format
    format: PixelFormat,
    
    /// Whether this is the last chunk
    is_last: bool,
    
    /// Allocator used for this chunk
    allocator: std.mem.Allocator,
    
    /// Free the chunk's data
    pub fn deinit(self: *ImageChunk) void {
        self.allocator.free(self.data);
        self.* = undefined;
    }
    
    /// Create a new chunk
    pub fn init(
        allocator: std.mem.Allocator,
        width: usize,
        rows: usize,
        start_row: usize,
        format: PixelFormat,
        is_last: bool,
    ) !ImageChunk {
        const bytes_per_pixel = format.getBytesPerPixel();
        const data_size = width * rows * bytes_per_pixel;
        const data = try allocator.alloc(u8, data_size);
        
        return ImageChunk{
            .data = data,
            .start_row = start_row,
            .rows = rows,
            .width = width,
            .format = format,
            .is_last = is_last,
            .allocator = allocator,
        };
    }
    
    /// Calculate byte offset for a specific pixel
    pub fn pixelOffset(self: ImageChunk, x: usize, y: usize) usize {
        const bytes_per_pixel = self.format.getBytesPerPixel();
        return ((y - self.start_row) * self.width + x) * bytes_per_pixel;
    }
    
    /// Get row size in bytes
    pub fn rowSize(self: ImageChunk) usize {
        return self.width * self.format.getBytesPerPixel();
    }
};

/// A streaming image processor interface
pub const StreamProcessor = struct {
    /// Process a chunk of image data
    processChunkFn: *const fn (self: *StreamProcessor, chunk: *ImageChunk) anyerror!void,
    
    /// Finalize processing and return result
    finalizeFn: *const fn (self: *StreamProcessor) anyerror![]u8,
    
    /// Process a chunk of image data
    pub fn processChunk(self: *StreamProcessor, chunk: *ImageChunk) !void {
        return self.processChunkFn(self, chunk);
    }
    
    /// Finalize processing and return result
    pub fn finalize(self: *StreamProcessor) ![]u8 {
        return self.finalizeFn(self);
    }
};

/// Streaming encoder for image data
pub const StreamingEncoder = struct {
    /// Common interface
    processor: StreamProcessor,
    
    /// Allocator for internal storage
    allocator: std.mem.Allocator,
    
    /// Target image format
    options: EncodingOptions,
    
    /// Total image width
    width: usize,
    
    /// Total image height
    height: usize,
    
    /// Pixel format
    format: PixelFormat,
    
    /// Temporary storage for accumulated chunks
    buffer: std.ArrayList(u8),
    
    /// Number of rows received so far
    rows_processed: usize,

    /// Create a new streaming encoder
    pub fn init(
        allocator: std.mem.Allocator,
        width: usize,
        height: usize,
        format: PixelFormat,
        options: EncodingOptions,
    ) !*StreamingEncoder {
        var self = try allocator.create(StreamingEncoder);
        
        self.* = StreamingEncoder{
            .processor = StreamProcessor{
                .processChunkFn = processChunk,
                .finalizeFn = finalize,
            },
            .allocator = allocator,
            .options = options,
            .width = width,
            .height = height,
            .format = format,
            .buffer = std.ArrayList(u8).init(allocator),
            .rows_processed = 0,
        };
        
        // Pre-allocate buffer with estimated size
        const bytes_per_pixel = format.getBytesPerPixel();
        const estimated_size = width * height * bytes_per_pixel;
        try self.buffer.ensureTotalCapacity(estimated_size);
        
        return self;
    }
    
    /// Free resources
    pub fn deinit(self: *StreamingEncoder) void {
        self.buffer.deinit();
        self.allocator.destroy(self);
    }
    
    /// Process a chunk of image data
    fn processChunk(processor: *StreamProcessor, chunk: *ImageChunk) !void {
        const self: *StreamingEncoder = @ptrCast(@alignCast(processor));
        
        // Validate chunk
        if (chunk.width != self.width) {
            return error.ChunkWidthMismatch;
        }
        
        if (chunk.start_row != self.rows_processed) {
            return error.ChunkOutOfOrder;
        }
        
        if (chunk.format != self.format) {
            return error.ChunkFormatMismatch;
        }
        
        // Append chunk data to buffer
        try self.buffer.appendSlice(chunk.data);
        
        // Update rows processed
        self.rows_processed += chunk.rows;
    }
    
    /// Finalize encoding and return compressed image data
    fn finalize(processor: *StreamProcessor) ![]u8 {
        const self: *StreamingEncoder = @ptrCast(@alignCast(processor));
        
        // Verify we received all rows
        if (self.rows_processed != self.height) {
            return error.IncompleteImage;
        }
        
        // Encode the accumulated image data
        const result = try encoder.encode(
            self.allocator, 
            self.buffer.items, 
            self.width, 
            self.height, 
            self.format, 
            self.options
        );
        
        return result;
    }
};

/// Streaming image resizer
pub const StreamingResizer = struct {
    /// Common interface
    processor: StreamProcessor,
    
    /// Allocator for internal storage
    allocator: std.mem.Allocator,
    
    /// Original image width
    src_width: usize,
    
    /// Original image height
    src_height: usize,
    
    /// Target image width
    dest_width: usize,
    
    /// Target image height
    dest_height: usize,
    
    /// Pixel format
    format: PixelFormat,
    
    /// Temporary buffer for source image
    source_buffer: std.ArrayList(u8),
    
    /// Number of source rows received
    rows_processed: usize,
    
    /// Next processor in the pipeline
    next_processor: ?*StreamProcessor,
    
    /// Algorithm to use for resizing
    algorithm: ResizeAlgorithm,
    
    /// Create a new streaming resizer
    pub fn init(
        allocator: std.mem.Allocator,
        src_width: usize,
        src_height: usize,
        dest_width: usize,
        dest_height: usize,
        format: PixelFormat,
        algorithm: ResizeAlgorithm,
        next_processor: ?*StreamProcessor,
    ) !*StreamingResizer {
        var self = try allocator.create(StreamingResizer);
        
        self.* = StreamingResizer{
            .processor = StreamProcessor{
                .processChunkFn = processChunk,
                .finalizeFn = finalize,
            },
            .allocator = allocator,
            .src_width = src_width,
            .src_height = src_height,
            .dest_width = dest_width,
            .dest_height = dest_height,
            .format = format,
            .source_buffer = std.ArrayList(u8).init(allocator),
            .rows_processed = 0,
            .next_processor = next_processor,
            .algorithm = algorithm,
        };
        
        // Pre-allocate the source buffer
        const bytes_per_pixel = format.getBytesPerPixel();
        const estimated_size = src_width * src_height * bytes_per_pixel;
        try self.source_buffer.ensureTotalCapacity(estimated_size);
        
        return self;
    }
    
    /// Free resources
    pub fn deinit(self: *StreamingResizer) void {
        self.source_buffer.deinit();
        self.allocator.destroy(self);
    }
    
    /// Process a chunk of image data
    fn processChunk(processor: *StreamProcessor, chunk: *ImageChunk) !void {
        const self: *StreamingResizer = @ptrCast(@alignCast(processor));
        
        // Validate chunk
        if (chunk.width != self.src_width) {
            return error.ChunkWidthMismatch;
        }
        
        if (chunk.start_row != self.rows_processed) {
            return error.ChunkOutOfOrder;
        }
        
        if (chunk.format != self.format) {
            return error.ChunkFormatMismatch;
        }
        
        // Append chunk data to buffer
        try self.source_buffer.appendSlice(chunk.data);
        
        // Update rows processed
        self.rows_processed += chunk.rows;
        
        // If we have enough rows or this is the last chunk, process a batch
        const min_rows_needed = calculateMinRowsNeeded(self.algorithm, self.src_height, self.dest_height);
        const can_process = self.rows_processed >= min_rows_needed or chunk.is_last;
        
        if (can_process and self.next_processor != null) {
            try self.processAvailableRows();
        }
    }
    
    /// Calculate how many source rows we need to produce a destination row
    fn calculateMinRowsNeeded(algorithm: ResizeAlgorithm, src_height: usize, dest_height: usize) usize {
        _ = dest_height;
        return switch (algorithm) {
            .Lanczos3 => @min(src_height, 6), // Lanczos3 kernel is 6 pixels wide
            .Bilinear => @min(src_height, 2), // Bilinear needs 2 rows
            .Bicubic => @min(src_height, 4),  // Bicubic needs 4 rows
            .Box => @min(src_height, 1),      // Box/nearest neighbor needs 1 row
        };
    }
    
    /// Process available rows into resized chunks
    fn processAvailableRows(self: *StreamingResizer) !void {
        if (self.next_processor == null) return;
        
        // Calculate how many destination rows we can produce
        const src_rows = self.rows_processed;
        const total_dest_rows = self.dest_height;
        const dest_rows_possible = calculateDestRows(src_rows, self.src_height, total_dest_rows);
        
        if (dest_rows_possible == 0) return;
        
        // Create a chunk with the resized data
        // Calculate the destination row based on the ratio of processed source rows
        const dest_row_start = if (dest_rows_possible > 0) 
            calculateDestRows(self.rows_processed - dest_rows_possible, self.src_height, self.dest_height)
        else 
            0;
            
        var dest_chunk = try ImageChunk.init(
            self.allocator,
            self.dest_width,
            dest_rows_possible,
            dest_row_start, // Set the appropriate starting row
            self.format,
            self.rows_processed == self.src_height, // Is last if we've processed all source rows
        );
        defer dest_chunk.deinit();
        
        // Perform the actual resize
        var mutable_dest_chunk = dest_chunk;
        try self.resizeChunk(&mutable_dest_chunk);
        
        // Pass to the next processor
        var mutable_chunk = dest_chunk;
        try self.next_processor.?.processChunk(&mutable_chunk);
    }
    
    /// Calculate how many destination rows we can produce from a given number of source rows
    fn calculateDestRows(src_rows: usize, src_height: usize, dest_height: usize) usize {
        const ratio = @as(f32, @floatFromInt(src_rows)) / @as(f32, @floatFromInt(src_height));
        const dest_rows = @as(usize, @intFromFloat(ratio * @as(f32, @floatFromInt(dest_height))));
        return dest_rows;
    }
    
    /// Resize the accumulated source rows to fill a destination chunk
    fn resizeChunk(self: *StreamingResizer, dest_chunk: *ImageChunk) !void {
        const bytes_per_pixel = self.format.getBytesPerPixel();
        
        // Source data
        const src_data = self.source_buffer.items;
        const src_width = self.src_width;
        const src_height = self.rows_processed; // Use only rows we've received
        
        // Destination info
        const dest_data = dest_chunk.data;
        const dest_width = self.dest_width;
        const dest_rows = dest_chunk.rows;
        
        // Perform resize based on selected algorithm
        switch (self.algorithm) {
            .Lanczos3 => {
                _ = try lanczos3.Lanczos3.resizePartial(
                    self.allocator,
                    src_data,
                    src_width,
                    src_height,
                    dest_width,
                    dest_rows,
                    bytes_per_pixel,
                    dest_data,
                );
            },
            .Bilinear => {
                _ = try bilinear.Bilinear.resizePartial(
                    self.allocator,
                    src_data,
                    src_width,
                    src_height,
                    dest_width,
                    dest_rows,
                    bytes_per_pixel,
                    dest_data,
                );
            },
            .Bicubic => {
                // For now, fall back to Bilinear as a placeholder
                _ = try bilinear.Bilinear.resizePartial(
                    self.allocator,
                    src_data,
                    src_width,
                    src_height,
                    dest_width,
                    dest_rows,
                    bytes_per_pixel,
                    dest_data,
                );
            },
            .Box => {
                // Simple box filter (nearest neighbor)
                // For now, fall back to Bilinear as a placeholder
                _ = try bilinear.Bilinear.resizePartial(
                    self.allocator,
                    src_data,
                    src_width,
                    src_height,
                    dest_width,
                    dest_rows,
                    bytes_per_pixel,
                    dest_data,
                );
            },
        }
    }
    
    /// Finalize resizing and pass to next processor
    fn finalize(processor: *StreamProcessor) ![]u8 {
        const self: *StreamingResizer = @ptrCast(@alignCast(processor));
        
        // Verify we received all rows
        if (self.rows_processed != self.src_height) {
            return error.IncompleteImage;
        }
        
        // If we have a next processor, finalize it
        if (self.next_processor) |next| {
            return try next.finalize();
        }
        
        // If no next processor, resize the complete image and return the result
        const bytes_per_pixel = self.format.getBytesPerPixel();
        const dest_buffer_size = self.dest_width * self.dest_height * bytes_per_pixel;
        const dest_buffer = try self.allocator.alloc(u8, dest_buffer_size);
        errdefer self.allocator.free(dest_buffer);
        
        switch (self.algorithm) {
            .Lanczos3 => {
                _ = try lanczos3.Lanczos3.resize(
                    self.allocator,
                    self.source_buffer.items,
                    self.src_width,
                    self.src_height,
                    self.dest_width,
                    self.dest_height,
                    bytes_per_pixel,
                );
            },
            .Bilinear => {
                _ = try bilinear.Bilinear.resize(
                    self.allocator,
                    self.source_buffer.items,
                    self.src_width,
                    self.src_height,
                    self.dest_width,
                    self.dest_height,
                    bytes_per_pixel,
                );
            },
            .Bicubic => {
                // For now, fall back to Bilinear as a placeholder
                _ = try bilinear.Bilinear.resize(
                    self.allocator,
                    self.source_buffer.items,
                    self.src_width,
                    self.src_height,
                    self.dest_width,
                    self.dest_height,
                    bytes_per_pixel,
                );
            },
            .Box => {
                // For now, fall back to Bilinear as a placeholder
                _ = try bilinear.Bilinear.resize(
                    self.allocator,
                    self.source_buffer.items,
                    self.src_width,
                    self.src_height,
                    self.dest_width,
                    self.dest_height,
                    bytes_per_pixel,
                );
            },
        }
        
        return dest_buffer;
    }
};

/// Available resize algorithms
pub const ResizeAlgorithm = enum {
    Lanczos3,
    Bilinear,
    Bicubic,
    Box,
};

/// Pipeline for streaming image processing
pub const ImagePipeline = struct {
    allocator: std.mem.Allocator,
    first_processor: *StreamProcessor,
    last_processor: *StreamProcessor,
    
    /// Initialize a pipeline with a first processor
    pub fn init(allocator: std.mem.Allocator, first: *StreamProcessor) ImagePipeline {
        return .{
            .allocator = allocator,
            .first_processor = first,
            .last_processor = first,
        };
    }
    
    /// Add a processor to the pipeline
    pub fn addProcessor(self: *ImagePipeline, processor: *StreamProcessor) void {
        // Connect the new processor to the pipeline
        if (self.first_processor == self.last_processor) {
            // Special case for the first processor
            // Check if first processor is a resizer by attempting to cast
            const is_resizer = @as(*StreamingResizer, @ptrCast(@alignCast(self.first_processor))) catch null;
            if (is_resizer) |resizer| {
                // If first processor is a resizer, set its next processor
                resizer.next_processor = processor;
            }
        }
        
        // Update the last processor
        self.last_processor = processor;
    }
    
    /// Process a chunk of image data
    pub fn processChunk(self: *ImagePipeline, chunk: *ImageChunk) !void {
        return self.first_processor.processChunk(chunk);
    }
    
    /// Finalize the pipeline and get the result
    pub fn finalize(self: *ImagePipeline) ![]u8 {
        return self.first_processor.finalize();
    }
};

/// Create a chunk iterator from a whole image
pub const ChunkIterator = struct {
    allocator: std.mem.Allocator,
    data: []const u8,
    width: usize,
    height: usize,
    format: PixelFormat,
    rows_per_chunk: usize,
    current_row: usize,
    
    pub fn init(
        allocator: std.mem.Allocator,
        data: []const u8,
        width: usize,
        height: usize,
        format: PixelFormat,
        rows_per_chunk: usize,
    ) ChunkIterator {
        return .{
            .allocator = allocator,
            .data = data,
            .width = width,
            .height = height,
            .format = format,
            .rows_per_chunk = rows_per_chunk,
            .current_row = 0,
        };
    }
    
    /// Get the next chunk, or null if done
    pub fn next(self: *ChunkIterator) !?ImageChunk {
        if (self.current_row >= self.height) return null;
        
        const bytes_per_pixel = self.format.getBytesPerPixel();
        const bytes_per_row = self.width * bytes_per_pixel;
        
        // Calculate how many rows to include in this chunk
        const rows_remaining = self.height - self.current_row;
        const rows_in_chunk = @min(self.rows_per_chunk, rows_remaining);
        const is_last = rows_in_chunk == rows_remaining;
        
        // Create the chunk
        const chunk = try ImageChunk.init(
            self.allocator,
            self.width,
            rows_in_chunk,
            self.current_row,
            self.format,
            is_last,
        );
        
        // Copy the data
        const start_offset = self.current_row * bytes_per_row;
        const end_offset = start_offset + (rows_in_chunk * bytes_per_row);
        @memcpy(chunk.data, self.data[start_offset..end_offset]);
        
        // Advance to the next row
        self.current_row += rows_in_chunk;
        
        return chunk;
    }
};

/// Simple example function to create a pipeline for resizing and encoding
pub fn createResizeEncodePipeline(
    allocator: std.mem.Allocator,
    src_width: usize,
    src_height: usize,
    dest_width: usize, 
    dest_height: usize,
    format: PixelFormat,
    resize_algorithm: ResizeAlgorithm,
    encode_options: EncodingOptions,
) !ImagePipeline {
    // Create the encoder
    var encoder_instance = try StreamingEncoder.init(
        allocator,
        dest_width,
        dest_height,
        format,
        encode_options,
    );
    
    // Create the resizer, connecting to the encoder
    var resizer_instance = try StreamingResizer.init(
        allocator,
        src_width,
        src_height,
        dest_width,
        dest_height,
        format,
        resize_algorithm,
        &encoder_instance.processor,
    );
    
    // Create and return the pipeline
    return ImagePipeline.init(allocator, &resizer_instance.processor);
}