# `Bun.Image`

Sharp-shaped image pipeline. Decode → (auto-orient) → transform\* → encode, all
off the JS thread.

## Layout

| file                                     | owns                                                                                                            | touch when                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `Image.classes.ts`                       | JS surface (codegen input)                                                                                      | adding/renaming a JS method              |
| `Image.zig`                              | JS↔Zig glue: arg parsing, op recording, `ConcurrentPromiseTask` scheduling, result delivery                     | new options, new chainable, new terminal |
| `codecs.zig`                             | thin `extern fn` wrappers over libjpeg-turbo / libspng / libwebp + the `Format` sniffer + the pixel-limit guard | bumping a codec, adding a format         |
| `codec_avif.zig`                         | Zig wrapper over `bun_avif_*` in `image_avif_shim.cpp`. Linux only.                                             | bumping pinned libavif ABI               |
| `exif.zig`                               | JPEG APP1/TIFF Orientation reader (tag 0x0112 only)                                                             | extending EXIF coverage                  |
| `quantize.zig`                           | median-cut RGBA → palette for `png({palette})`                                                                  | dithering, perceptual weighting          |
| `backend_coregraphics.zig`               | macOS ImageIO/CoreGraphics, lazy `dlopen`                                                                       | macOS-specific behaviour                 |
| `backend_wic.zig`                        | Windows WIC, COM                                                                                                | Windows-specific behaviour               |
| `../../jsc/bindings/image_resize.cpp`    | highway resize/rotate/flip/modulate kernels (`bun_image_*` C ABI)                                               | new filter, perf work                    |
| `../../jsc/bindings/image_avif_shim.cpp` | dlopen'd libavif.so.16 loader + decode/encode wrapper; pinned v1.0.0 struct layout                              | libavif ABI bumps                        |

`system_backend` in `codecs.zig` is `?type` — `null` on Linux so the dispatch
compiles away. On macOS/Windows the backend is tried first; it returns
`error.BackendUnavailable` for anything it can't do (palette PNG, lossless
WebP, dlopen miss) and the static path takes over.

The JPEG/PNG/WebP codecs are vendored and statically linked via
`scripts/build/deps/{libjpeg-turbo,libspng,libwebp}.ts`; `patches/libjpeg-turbo/`
carries the 8-bit-only patch + the j12/j16 stub overlay. AVIF is different:
`image_avif_shim.cpp` dlopens `libavif.so.16` at first use and dlsyms the
decoder + encoder entry points, so bun has no link-time dependency on
libavif/dav1d — the feature works only where the distro ships those packages
(Debian trixie+, Ubuntu 24.04+, Fedora 39+, Alpine 3.20+) and falls back to
`ERR_IMAGE_FORMAT_UNSUPPORTED` everywhere else. Encode uses whichever AV1
encoder libavif was linked against (aom / rav1e / SvtAv1Enc); a decode-only
libavif build surfaces `ERR_IMAGE_ENCODE_FAILED`. macOS/Windows decode and
encode AVIF via their respective system backends.

## Adding a chainable op

1. Add a field to `Pipeline` in `Image.zig` (one slot per op — setters
   overwrite, there is no op list) and a stage in `PipelineTask.applyPipeline`
   at the right point in the fixed `rotate → flip/flop → resize → modulate`
   order.
2. Add a `do<Name>` method that parses args, writes the slot, returns
   `callframe.this()`.
3. Add it to `proto:` in `Image.classes.ts`.
4. If it needs a kernel, put the C ABI in `image_resize.cpp` and the `extern`
   in `codecs.zig`.

## Adding a format

1. New `scripts/build/deps/<lib>.ts` (copy `libspng.ts` for the simple case).
2. Extend `Format` + `sniff()` + `mime()` in `codecs.zig`, add a `pub const
<fmt> = struct { decode/encode }` block alongside the others.
3. If the format carries EXIF, extend `exif.zig`.
4. `LICENSE.md` row.

## Invariants

- Pixel format is **RGBA8 everywhere** between decode and encode. Decoders are
  configured to emit it; encoders are fed it. Nothing branches on channels.
- **Decode** output is `bun.default_allocator`-owned `[]u8`. **Encode** output
  is `Encoded{bytes, free}` where `free` is the _codec's_ deallocator
  (`tj3Free`/`WebPFree`/`std.c.free`/`mi_free`); `then()` hands that buffer
  straight to JS via `ArrayBuffer.toJSWithContext(..., free)` — no dupe. New
  codecs return `Encoded` with the right `free`, not a default_allocator slice.
- The `max_pixels` guard fires **after the header read, before the RGBA alloc**
  in every codec. New codecs must do the same.
- `image_resize.cpp` must stay in `noUnify` (see `scripts/build/unified.ts`) —
  highway's `foreach_target.h` has a TU-wide include guard that breaks with
  two highway TUs in one bundle.
