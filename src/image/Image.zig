const bun = @import("root").bun;
const std = @import("std");
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;
const default_allocator = bun.default_allocator;
const encoder = @import("encoder.zig");
const ImageFormat = encoder.ImageFormat;
const EncodingOptions = encoder.EncodingOptions;
const EncodingQuality = encoder.EncodingQuality;
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const Allocator = std.mem.Allocator;
const lanczos3 = @import("lanczos3.zig");
const bicubic = @import("bicubic.zig");
const bilinear = @import("bilinear.zig");
const box = @import("box.zig");

pub const ImageScalingAlgorithm = enum {
    lanczos3,
    bicubic,
    bilinear,
    box,

    pub fn scale(
        self: ImageScalingAlgorithm,
        allocator: Allocator,
        src: []const u8,
        src_width: usize,
        src_height: usize,
        dest_width: usize,
        dest_height: usize,
        format: PixelFormat,
    ) ![]u8 {
        return switch (self) {
            .lanczos3 => try lanczos3.scale(allocator, src, src_width, src_height, dest_width, dest_height, format),
            .bicubic => try bicubic.scale(allocator, src, src_width, src_height, dest_width, dest_height, format),
            .bilinear => try bilinear.scale(allocator, src, src_width, src_height, dest_width, dest_height, format),
            .box => try box.scale(allocator, src, src_width, src_height, dest_width, dest_height, format),
        };
    }
};

pub const ResizeOptions = struct {
    x: ?i32 = null,
    y: ?i32 = null,
    width: usize,
    height: usize,
    quality: ?u8 = null,
    algorithm: ImageScalingAlgorithm = .lanczos3,
};

// Image represents the main image object exposed to JavaScript
pub const Image = struct {
    allocator: Allocator,
    data: []u8,
    width: usize,
    height: usize,
    format: PixelFormat,
    encoding: ImageFormat,
    
    pub usingnamespace JSC.Codegen.JSImage;
    
    pub fn constructor(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!*Image {
        return globalThis.throw("Invalid constructor. Use Bun.image() instead", .{});
    }
    
    // Static factory method to create a new Image instance
    pub fn image(globalThis: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const args = callFrame.arguments(1);
        if (args.len == 0) {
            return globalThis.throw("Missing data argument", .{});
        }
        
        // Support ArrayBuffer or TypedArray
        const bytes = try args[0].toBytesUnsafe(globalThis);
        if (bytes.len == 0) {
            return globalThis.throw("Invalid image data", .{});
        }
        
        // Determine image format and dimensions
        // Here you would typically parse the image header to get this information
        // For simplicity, we'll create a stub that assumes it's a valid image
        
        // Create an Image instance
        var image_obj = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        image_obj.* = Image{
            .allocator = default_allocator,
            .data = try default_allocator.dupe(u8, bytes),
            .width = 0, // To be determined later
            .height = 0, // To be determined later
            .format = .RGBA, // Default format
            .encoding = .JPEG, // Default encoding, to be determined
        };
        
        return image_obj.toJS(globalThis);
    }
    
    // Get the current encoding format as a string
    pub fn getEncoding(this: *Image, globalThis: *JSGlobalObject) JSC.JSValue {
        const encoding_str = switch (this.encoding) {
            .JPEG => "jpg",
            .PNG => "png",
            .WEBP => "webp",
            .AVIF => "avif",
            .TIFF => "tiff",
            .HEIC => "heic",
        };
        
        return ZigString.init(encoding_str).toJS(globalThis);
    }
    
    // Get the image width
    pub fn getWidth(this: *Image, _: *JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.jsNumber(@intCast(this.width));
    }
    
    // Get the image height
    pub fn getHeight(this: *Image, _: *JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.jsNumber(@intCast(this.height));
    }
    
    // Get the image dimensions asynchronously
    pub fn size(
        this: *Image,
        globalThis: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        var object = JSC.JSValue.createEmptyObject(globalThis, 2);
        object.put(globalThis, ZigString.static("width"), JSC.JSValue.jsNumber(@intCast(this.width)));
        object.put(globalThis, ZigString.static("height"), JSC.JSValue.jsNumber(@intCast(this.height)));
        
        // Create a resolved promise with the dimensions object
        return JSC.JSPromise.createResolved(globalThis, object);
    }
    
    // Resize the image with options
    pub fn resize(
        this: *Image,
        globalThis: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const args = callFrame.arguments(2);
        if (args.len == 0) {
            return globalThis.throw("Missing resize parameters", .{});
        }
        
        var options = ResizeOptions{
            .width = 0,
            .height = 0,
        };
        
        // Process arguments: either (width, height, [quality]) or (options object)
        if (args[0].isObject()) {
            // Parse from options object
            var options_obj = args[0].asObjectRef();
            
            // Get width and height (required)
            const width_val = options_obj.get(globalThis, ZigString.static("width"));
            const height_val = options_obj.get(globalThis, ZigString.static("height"));
            
            if (!width_val.isNumber() or !height_val.isNumber()) {
                return globalThis.throw("Width and height are required and must be numbers", .{});
            }
            
            options.width = @intFromFloat(width_val.asNumber());
            options.height = @intFromFloat(height_val.asNumber());
            
            // Get optional parameters
            const x_val = options_obj.get(globalThis, ZigString.static("x"));
            if (x_val.isNumber()) {
                options.x = @intFromFloat(x_val.asNumber());
            }
            
            const y_val = options_obj.get(globalThis, ZigString.static("y"));
            if (y_val.isNumber()) {
                options.y = @intFromFloat(y_val.asNumber());
            }
            
            const quality_val = options_obj.get(globalThis, ZigString.static("quality"));
            if (quality_val.isNumber()) {
                options.quality = @intFromFloat(quality_val.asNumber());
            }
        } else if (args[0].isNumber() and args.len > 1 and args[1].isNumber()) {
            // Parse from width, height arguments
            options.width = @intFromFloat(args[0].asNumber());
            options.height = @intFromFloat(args[1].asNumber());
            
            if (args.len > 2 and args[2].isNumber()) {
                options.quality = @intFromFloat(args[2].asNumber());
            }
        } else {
            return globalThis.throw("Invalid resize parameters", .{});
        }
        
        // Validate dimensions
        if (options.width == 0 or options.height == 0) {
            return globalThis.throw("Width and height must be greater than 0", .{});
        }
        
        // Create a new Image instance with the resized data
        var resized_image = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        // Apply the resize operation
        var scaled_data = options.algorithm.scale(
            this.allocator,
            this.data,
            this.width,
            this.height,
            options.width,
            options.height,
            this.format,
        ) catch |err| {
            defer default_allocator.destroy(resized_image);
            return globalThis.throw("Failed to resize image: {s}", .{@errorName(err)});
        };
        
        // Update the image properties
        resized_image.* = Image{
            .allocator = default_allocator,
            .data = scaled_data,
            .width = options.width,
            .height = options.height,
            .format = this.format,
            .encoding = this.encoding,
        };
        
        return resized_image.toJS(globalThis);
    }
    
    // Get the raw bytes of the image
    pub fn bytes(
        this: *Image,
        globalThis: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const arrayBuffer = JSC.ArrayBuffer.create(globalThis, this.data.len) orelse
            return globalThis.throwOutOfMemoryError();
        
        var bytes_copy = arrayBuffer.slice();
        @memcpy(bytes_copy, this.data);
        
        // Create a resolved promise with the buffer
        return JSC.JSPromise.createResolved(globalThis, arrayBuffer.toJS());
    }
    
    // Get the image as a blob
    pub fn blob(
        this: *Image,
        globalThis: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        // Create a blob with the image data
        const mime_type = this.encoding.mimeType();
        const options = JSC.JSValue.createEmptyObject(globalThis, 1);
        options.put(globalThis, ZigString.static("type"), ZigString.init(mime_type).toJS(globalThis));
        
        const array = JSC.JSC_JSArray.create(globalThis, 1);
        const arrayBuffer = JSC.ArrayBuffer.create(globalThis, this.data.len) orelse
            return globalThis.throwOutOfMemoryError();
        
        var bytes_copy = arrayBuffer.slice();
        @memcpy(bytes_copy, this.data);
        
        array.setIndex(globalThis, 0, arrayBuffer.toJS());
        
        const blob = try globalThis.blobFrom(array.toJS(), options);
        
        // Create a resolved promise with the blob
        return JSC.JSPromise.createResolved(globalThis, blob);
    }
    
    // Convert to JPEG format
    pub fn toJPEG(
        this: *Image,
        globalThis: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const args = callFrame.arguments(1);
        var quality: u8 = 80; // Default quality
        
        if (args.len > 0 and args[0].isObject()) {
            var options_obj = args[0].asObjectRef();
            const quality_val = options_obj.get(globalThis, ZigString.static("quality"));
            if (quality_val.isNumber()) {
                quality = @intFromFloat(quality_val.asNumber());
            }
        }
        
        // Clamp quality to 0-100
        quality = @min(@max(quality, 0), 100);
        
        if (this.encoding == .JPEG) {
            // If already JPEG, just update quality if needed
            if (quality == 80) {
                return this.toJS(globalThis); // Return this if no change
            }
        }
        
        // Create a new Image instance for the converted format
        var jpeg_image = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        // Convert to JPEG
        var jpeg_data: []u8 = undefined;
        
        if (this.encoding == .JPEG) {
            // If already JPEG, just make a copy
            jpeg_data = try this.allocator.dupe(u8, this.data);
        } else {
            // Convert from other format to JPEG
            const encoding_options = EncodingOptions{
                .format = .JPEG,
                .quality = .{ .quality = quality },
            };
            
            // Try to transcode directly if possible
            jpeg_data = encoder.transcode(
                this.allocator,
                this.data,
                this.encoding,
                .JPEG,
                encoding_options,
            ) catch |err| {
                defer default_allocator.destroy(jpeg_image);
                return globalThis.throw("Failed to convert to JPEG: {s}", .{@errorName(err)});
            };
        }
        
        // Update the image properties
        jpeg_image.* = Image{
            .allocator = default_allocator,
            .data = jpeg_data,
            .width = this.width,
            .height = this.height,
            .format = this.format,
            .encoding = .JPEG,
        };
        
        return jpeg_image.toJS(globalThis);
    }
    
    // Convert to PNG format
    pub fn toPNG(
        this: *Image,
        globalThis: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        // PNG doesn't use quality, but we'll parse options for consistency
        _ = callFrame.arguments(1);
        
        if (this.encoding == .PNG) {
            return this.toJS(globalThis); // Return this if already PNG
        }
        
        // Create a new Image instance for the converted format
        var png_image = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        // Convert to PNG
        const encoding_options = EncodingOptions{
            .format = .PNG,
        };
        
        // Try to transcode directly if possible
        var png_data = encoder.transcode(
            this.allocator,
            this.data,
            this.encoding,
            .PNG,
            encoding_options,
        ) catch |err| {
            defer default_allocator.destroy(png_image);
            return globalThis.throw("Failed to convert to PNG: {s}", .{@errorName(err)});
        };
        
        // Update the image properties
        png_image.* = Image{
            .allocator = default_allocator,
            .data = png_data,
            .width = this.width,
            .height = this.height,
            .format = this.format,
            .encoding = .PNG,
        };
        
        return png_image.toJS(globalThis);
    }
    
    // Convert to WebP format
    pub fn toWEBP(
        this: *Image,
        globalThis: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const args = callFrame.arguments(1);
        var quality: u8 = 80; // Default quality
        
        if (args.len > 0 and args[0].isObject()) {
            var options_obj = args[0].asObjectRef();
            const quality_val = options_obj.get(globalThis, ZigString.static("quality"));
            if (quality_val.isNumber()) {
                quality = @intFromFloat(quality_val.asNumber());
            }
        }
        
        // Clamp quality to 0-100
        quality = @min(@max(quality, 0), 100);
        
        if (this.encoding == .WEBP) {
            // If already WebP, just update quality if needed
            if (quality == 80) {
                return this.toJS(globalThis); // Return this if no change
            }
        }
        
        // Create a new Image instance for the converted format
        var webp_image = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        // Convert to WebP
        const encoding_options = EncodingOptions{
            .format = .WEBP,
            .quality = .{ .quality = quality },
        };
        
        // Try to transcode directly if possible
        var webp_data = encoder.transcode(
            this.allocator,
            this.data,
            this.encoding,
            .WEBP,
            encoding_options,
        ) catch |err| {
            defer default_allocator.destroy(webp_image);
            return globalThis.throw("Failed to convert to WebP: {s}", .{@errorName(err)});
        };
        
        // Update the image properties
        webp_image.* = Image{
            .allocator = default_allocator,
            .data = webp_data,
            .width = this.width,
            .height = this.height,
            .format = this.format,
            .encoding = .WEBP,
        };
        
        return webp_image.toJS(globalThis);
    }
    
    // Convert to AVIF format
    pub fn toAVIF(
        this: *Image,
        globalThis: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const args = callFrame.arguments(1);
        var quality: u8 = 80; // Default quality
        
        if (args.len > 0 and args[0].isObject()) {
            var options_obj = args[0].asObjectRef();
            const quality_val = options_obj.get(globalThis, ZigString.static("quality"));
            if (quality_val.isNumber()) {
                quality = @intFromFloat(quality_val.asNumber());
            }
        }
        
        // Clamp quality to 0-100
        quality = @min(@max(quality, 0), 100);
        
        if (this.encoding == .AVIF) {
            // If already AVIF, just update quality if needed
            if (quality == 80) {
                return this.toJS(globalThis); // Return this if no change
            }
        }
        
        // Create a new Image instance for the converted format
        var avif_image = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        // Convert to AVIF
        const encoding_options = EncodingOptions{
            .format = .AVIF,
            .quality = .{ .quality = quality },
        };
        
        // Try to transcode directly if possible
        var avif_data = encoder.transcode(
            this.allocator,
            this.data,
            this.encoding,
            .AVIF,
            encoding_options,
        ) catch |err| {
            defer default_allocator.destroy(avif_image);
            return globalThis.throw("Failed to convert to AVIF: {s}", .{@errorName(err)});
        };
        
        // Update the image properties
        avif_image.* = Image{
            .allocator = default_allocator,
            .data = avif_data,
            .width = this.width,
            .height = this.height,
            .format = this.format,
            .encoding = .AVIF,
        };
        
        return avif_image.toJS(globalThis);
    }
    
    // Convert to TIFF format
    pub fn toTIFF(
        this: *Image,
        globalThis: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        // TIFF doesn't typically use quality, but we'll parse options for consistency
        _ = callFrame.arguments(1);
        
        if (this.encoding == .TIFF) {
            return this.toJS(globalThis); // Return this if already TIFF
        }
        
        // Create a new Image instance for the converted format
        var tiff_image = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        // Convert to TIFF
        const encoding_options = EncodingOptions{
            .format = .TIFF,
        };
        
        // Try to transcode directly if possible
        var tiff_data = encoder.transcode(
            this.allocator,
            this.data,
            this.encoding,
            .TIFF,
            encoding_options,
        ) catch |err| {
            defer default_allocator.destroy(tiff_image);
            return globalThis.throw("Failed to convert to TIFF: {s}", .{@errorName(err)});
        };
        
        // Update the image properties
        tiff_image.* = Image{
            .allocator = default_allocator,
            .data = tiff_data,
            .width = this.width,
            .height = this.height,
            .format = this.format,
            .encoding = .TIFF,
        };
        
        return tiff_image.toJS(globalThis);
    }
    
    // Convert to HEIC format
    pub fn toHEIC(
        this: *Image,
        globalThis: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const args = callFrame.arguments(1);
        var quality: u8 = 80; // Default quality
        
        if (args.len > 0 and args[0].isObject()) {
            var options_obj = args[0].asObjectRef();
            const quality_val = options_obj.get(globalThis, ZigString.static("quality"));
            if (quality_val.isNumber()) {
                quality = @intFromFloat(quality_val.asNumber());
            }
        }
        
        // Clamp quality to 0-100
        quality = @min(@max(quality, 0), 100);
        
        if (this.encoding == .HEIC) {
            // If already HEIC, just update quality if needed
            if (quality == 80) {
                return this.toJS(globalThis); // Return this if no change
            }
        }
        
        // Create a new Image instance for the converted format
        var heic_image = default_allocator.create(Image) catch {
            return globalThis.throwOutOfMemoryError();
        };
        
        // Convert to HEIC
        const encoding_options = EncodingOptions{
            .format = .HEIC,
            .quality = .{ .quality = quality },
        };
        
        // Try to transcode directly if possible
        var heic_data = encoder.transcode(
            this.allocator,
            this.data,
            this.encoding,
            .HEIC,
            encoding_options,
        ) catch |err| {
            defer default_allocator.destroy(heic_image);
            return globalThis.throw("Failed to convert to HEIC: {s}", .{@errorName(err)});
        };
        
        // Update the image properties
        heic_image.* = Image{
            .allocator = default_allocator,
            .data = heic_data,
            .width = this.width,
            .height = this.height,
            .format = this.format,
            .encoding = .HEIC,
        };
        
        return heic_image.toJS(globalThis);
    }
    
    // String representation of the image
    pub fn toString(
        this: *Image,
        globalThis: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const description = std.fmt.allocPrint(
            this.allocator,
            "[object Image {{width: {d}, height: {d}, encoding: {s}}}]",
            .{ this.width, this.height, @tagName(this.encoding) },
        ) catch {
            return globalThis.throwOutOfMemoryError();
        };
        defer this.allocator.free(description);
        
        return ZigString.init(description).toJS(globalThis);
    }
    
    // JSON representation of the image
    pub fn toJSON(
        this: *Image,
        globalThis: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        var object = JSC.JSValue.createEmptyObject(globalThis, 3);
        object.put(globalThis, ZigString.static("width"), JSC.JSValue.jsNumber(@intCast(this.width)));
        object.put(globalThis, ZigString.static("height"), JSC.JSValue.jsNumber(@intCast(this.height)));
        object.put(globalThis, ZigString.static("encoding"), this.getEncoding(globalThis));
        
        return object;
    }
    
    // Clean up resources
    pub fn finalize(this: *Image) callconv(.C) void {
        this.allocator.free(this.data);
        this.allocator.destroy(this);
    }
};