const std = @import("std");
const pixel_format = @import("pixel_format.zig");
const PixelFormat = pixel_format.PixelFormat;
const EncodingOptions = @import("encoder.zig").EncodingOptions;
const ImageFormat = @import("encoder.zig").ImageFormat;

// Import the required Windows headers for WIC
const w = @cImport({
    @cInclude("windows.h");
    @cInclude("combaseapi.h");
    @cInclude("objbase.h");
    @cInclude("wincodec.h");
});

// Error handling helpers for COM calls
fn SUCCEEDED(hr: w.HRESULT) bool {
    return hr >= 0;
}

fn FAILED(hr: w.HRESULT) bool {
    return hr < 0;
}

// Helper to safely release COM interfaces
fn safeRelease(obj: anytype) void {
    if (obj != null) {
        _ = obj.*.lpVtbl.*.Release.?(obj);
    }
}

// Get the GUID for the specified image format encoder
fn getEncoderGUID(format: ImageFormat) w.GUID {
    return switch (format) {
        .JPEG => w.GUID_ContainerFormatJpeg,
        .PNG => w.GUID_ContainerFormatPng,
        .WEBP => w.GUID{ // WebP GUID (Not defined in all Windows SDK versions)
            .Data1 = 0x1b7cfaf4,
            .Data2 = 0x713f,
            .Data3 = 0x4dd9,
            .Data4 = [8]u8{ 0xB2, 0xBC, 0xA2, 0xC4, 0xC4, 0x8B, 0x97, 0x61 },
        },
        .AVIF => w.GUID{ // AVIF GUID (Not defined in all Windows SDK versions)
            .Data1 = 0x9e81d650,
            .Data2 = 0x7c3f,
            .Data3 = 0x46d3,
            .Data4 = [8]u8{ 0x87, 0x58, 0xc9, 0x1d, 0x2b, 0xc8, 0x7e, 0x41 },
        },
    };
}

// Get the pixel format GUID for the specified pixel format
fn getWICPixelFormat(format: PixelFormat) w.GUID {
    return switch (format) {
        .Gray => w.GUID_WICPixelFormat8bppGray,
        .GrayAlpha => w.GUID_WICPixelFormat16bppGray,
        .RGB => w.GUID_WICPixelFormat24bppRGB,
        .RGBA => w.GUID_WICPixelFormat32bppRGBA,
        .BGR => w.GUID_WICPixelFormat24bppBGR,
        .BGRA => w.GUID_WICPixelFormat32bppBGRA,
        .ARGB => w.GUID_WICPixelFormat32bppARGB,
        .ABGR => w.GUID_WICPixelFormat32bppPRGBA, // Closest match for ABGR
    };
}

/// Windows implementation using WIC (Windows Imaging Component)
pub fn encode(
    allocator: std.mem.Allocator,
    source: []const u8,
    width: usize,
    height: usize,
    format: PixelFormat,
    options: EncodingOptions,
) ![]u8 {
    // Early return if dimensions are invalid
    if (width == 0 or height == 0) {
        return error.InvalidDimensions;
    }

    // Calculate bytes per pixel and row bytes
    const bytes_per_pixel = format.getBytesPerPixel();
    const stride = width * bytes_per_pixel;

    // Initialize COM library
    const hr_com = w.CoInitializeEx(null, w.COINIT_APARTMENTTHREADED | w.COINIT_DISABLE_OLE1DDE);
    if (FAILED(hr_com) and hr_com != w.RPC_E_CHANGED_MODE) {
        return error.CouldNotInitializeCOM;
    }
    defer w.CoUninitialize();

    // Create WIC factory
    var factory: ?*w.IWICImagingFactory = null;
    const hr_factory = w.CoCreateInstance(
        &w.CLSID_WICImagingFactory,
        null,
        w.CLSCTX_INPROC_SERVER,
        &w.IID_IWICImagingFactory,
        @ptrCast(&factory),
    );
    if (FAILED(hr_factory)) {
        return error.CouldNotCreateWICFactory;
    }
    defer safeRelease(factory);

    // Create memory stream
    var stream: ?*w.IStream = null;
    const hr_stream = w.CreateStreamOnHGlobal(null, w.TRUE, &stream);
    if (FAILED(hr_stream)) {
        return error.CouldNotCreateStream;
    }
    defer safeRelease(stream);

    // Create encoder based on format
    var encoder: ?*w.IWICBitmapEncoder = null;
    const encoder_guid = getEncoderGUID(options.format);
    const hr_encoder = factory.?.lpVtbl.*.CreateEncoder.?(factory.?, &encoder_guid, null, &encoder);
    if (FAILED(hr_encoder)) {
        return error.CouldNotCreateEncoder;
    }
    defer safeRelease(encoder);

    // Initialize encoder with stream
    const hr_init = encoder.?.lpVtbl.*.Initialize.?(encoder.?, stream.?, w.WICBitmapEncoderNoCache);
    if (FAILED(hr_init)) {
        return error.CouldNotInitializeEncoder;
    }

    // Create frame encoder
    var frame_encoder: ?*w.IWICBitmapFrameEncode = null;
    var property_bag: ?*w.IPropertyBag2 = null;
    const hr_frame = encoder.?.lpVtbl.*.CreateNewFrame.?(encoder.?, &frame_encoder, &property_bag);
    if (FAILED(hr_frame)) {
        return error.CouldNotCreateFrameEncoder;
    }
    defer safeRelease(frame_encoder);
    defer safeRelease(property_bag);

    // Set frame properties based on format
    if (options.format == .JPEG) {
        // Set JPEG quality
        const quality_value = w.PROPVARIANT{
            .vt = w.VT_R4,
            .Anonymous = @as(@TypeOf(w.PROPVARIANT.Anonymous), @bitCast(@unionInit(
                @TypeOf(w.PROPVARIANT.Anonymous),
                "fltVal",
                @as(f32, @floatFromInt(options.quality.quality)) / 100.0,
            ))),
        };

        _ = property_bag.?.lpVtbl.*.Write.?(
            property_bag.?,
            1,
            &[_]w.PROPBAG2{
                .{
                    .pstrName = w.L("ImageQuality"),
                    .dwType = w.PROPBAG2_TYPE_DATA,
                    .vt = w.VT_R4,
                    .cfType = 0,
                    .dwHint = 0,
                    .pstrName_v2 = null,
                    .pszSuffix = null,
                },
            },
            &[_]w.PROPVARIANT{quality_value},
        );
    }

    // Initialize frame encoder
    const hr_frame_init = frame_encoder.?.lpVtbl.*.Initialize.?(frame_encoder.?, property_bag.?);
    if (FAILED(hr_frame_init)) {
        return error.CouldNotInitializeFrameEncoder;
    }

    // Set frame size
    const hr_size = frame_encoder.?.lpVtbl.*.SetSize.?(
        frame_encoder.?,
        @intCast(width),
        @intCast(height),
    );
    if (FAILED(hr_size)) {
        return error.CouldNotSetFrameSize;
    }

    // Set pixel format
    var pixel_format_guid = getWICPixelFormat(format);
    const hr_format = frame_encoder.?.lpVtbl.*.SetPixelFormat.?(frame_encoder.?, &pixel_format_guid);
    if (FAILED(hr_format)) {
        return error.CouldNotSetPixelFormat;
    }

    // Check if we need pixel format conversion
    var need_conversion = false;
    if (!w.IsEqualGUID(&pixel_format_guid, &getWICPixelFormat(format))) {
        need_conversion = true;
        // Handle conversion if needed (not implemented in this example)
        return error.UnsupportedPixelFormat;
    }

    // Write pixels
    const hr_pixels = frame_encoder.?.lpVtbl.*.WritePixels.?(
        frame_encoder.?,
        @intCast(height),
        @intCast(stride),
        @intCast(stride * height),
        @ptrCast(@constCast(source.ptr)),
    );
    if (FAILED(hr_pixels)) {
        return error.CouldNotWritePixels;
    }

    // Commit the frame
    const hr_commit_frame = frame_encoder.?.lpVtbl.*.Commit.?(frame_encoder.?);
    if (FAILED(hr_commit_frame)) {
        return error.CouldNotCommitFrame;
    }

    // Commit the encoder
    const hr_commit = encoder.?.lpVtbl.*.Commit.?(encoder.?);
    if (FAILED(hr_commit)) {
        return error.CouldNotCommitEncoder;
    }

    // Get the stream data
    var glob: ?w.HGLOBAL = null;
    const hr_glob = w.GetHGlobalFromStream(stream.?, &glob);
    if (FAILED(hr_glob)) {
        return error.CouldNotGetStreamData;
    }

    // Lock the memory
    const buffer = w.GlobalLock(glob.?);
    if (buffer == null) {
        return error.CouldNotLockMemory;
    }
    defer _ = w.GlobalUnlock(glob.?);

    // Get the size of the stream
    var stat: w.STATSTG = undefined;
    const hr_stat = stream.?.lpVtbl.*.Stat.?(stream.?, &stat, w.STATFLAG_NONAME);
    if (FAILED(hr_stat)) {
        return error.CouldNotGetStreamSize;
    }

    const size = @as(usize, @intCast(stat.cbSize.QuadPart));

    // Copy the data to a new buffer that can be managed by the caller
    const output = try allocator.alloc(u8, size);
    @memcpy(output, @as([*]u8, @ptrCast(buffer))[0..size]);

    return output;
}