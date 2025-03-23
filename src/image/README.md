# Bun Image Processing Library

A high-performance image processing library for Bun, written in Zig.

## Features

- **Image Resizing**: Fast, high-quality resizing using Lanczos3 algorithm
- **SIMD Optimization**: Utilizes SIMD vectors for improved performance
- **Flexible API**: Supports various image formats and color spaces

## Implemented Algorithms

### Lanczos3

Lanczos3 is a high-quality image resampling algorithm that uses a windowed sinc function with a=3 as its kernel. It produces excellent results for both upscaling and downscaling images.

#### Algorithm details:
- Kernel size: 6×6 (a=3)
- Two-pass approach for efficiency (horizontal pass followed by vertical pass)
- SIMD optimization for 4x throughput on compatible operations
- Handles grayscale and multi-channel (RGB, RGBA) images

## Usage Example

```zig
const std = @import("std");
const image = @import("image/lanczos3.zig");

pub fn main() !void {
    const allocator = std.heap.page_allocator;
    
    // Load source image (example with 100x100 grayscale)
    const src_width = 100;
    const src_height = 100;
    const bytes_per_pixel = 1; // 1 for grayscale, 3 for RGB, 4 for RGBA
    var src_buffer: []u8 = loadImageSomehow();
    
    // Resize to 200x200
    const dest_width = 200;
    const dest_height = 200;
    
    const resized_buffer = try image.Lanczos3.resize(
        allocator,
        src_buffer,
        src_width,
        src_height,
        dest_width,
        dest_height,
        bytes_per_pixel
    );
    defer allocator.free(resized_buffer);
    
    // Now use the resized image data
    saveImageSomehow(resized_buffer, dest_width, dest_height);
}
```

## Performance

The Lanczos3 implementation includes SIMD optimizations for significant performance gains on modern CPUs. For single-channel (grayscale) images, the library can process 4 pixels in parallel using vectorized operations.

## Roadmap

- [x] Lanczos3 resampling
- [x] Bilinear resampling
- [x] Bicubic resampling
- [x] Box (nearest neighbor) resampling
- [x] Pixel format conversion
- [x] JPEG encoding (macOS)
- [x] PNG encoding (macOS)
- [ ] JPEG encoding (Linux/Windows)
- [ ] PNG encoding (Linux/Windows)
- [ ] WebP encoding/decoding
- [ ] AVIF encoding/decoding