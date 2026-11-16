# `Bun.Image`

Sharp-shaped image pipeline. Decode → (auto-orient) → transform\* → encode, all
off the JS thread.

## Layout

| file                                  | owns                                                                                                  | touch when                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `Image.bind.ts`                       | JS surface (codegen input)                                                                            | adding/renaming a JS method              |
| `Image.rs`                            | JS↔native glue: arg parsing, op recording, `ConcurrentPromiseTask` scheduling, result delivery        | new options, new chainable, new terminal |
| `codecs.rs`                           | thin wrappers over `bun_jpeg` / `bun_png` / `bun_webp` + the `Format` sniffer + the pixel-limit guard | bumping a codec, adding a format         |
| `exif.rs`                             | JPEG APP1/TIFF Orientation reader (tag 0x0112 only)                                                   | extending EXIF coverage                  |
| `quantize.rs`                         | median-cut RGBA → palette for `png({palette})`                                                        | dithering, perceptual weighting          |
| `backend_coregraphics.rs`             | macOS ImageIO/CoreGraphics, lazy `dlopen`                                                             | macOS-specific behaviour                 |
| `backend_wic.rs`                      | Windows WIC, COM                                                                                      | Windows-specific behaviour               |
| `../bun.js/bindings/image_resize.cpp` | highway resize/rotate/flip/modulate kernels (`bun_image_*` C ABI)                                     | new filter, perf work                    |

`system_backend` in `codecs.rs` is a cfg-gated module re-export — absent on Linux (callers gate on `HAS_SYSTEM_BACKEND`), so the dispatch
compiles away. On macOS/Windows the backend is tried first; it returns
a `BackendUnavailable` error for anything it can't do (palette PNG, lossless
WebP, dlopen miss) and the static path takes over.

JPEG, PNG and WebP are `src/jpeg`, `src/png` and `src/webp`, in Rust, on the kernels in `src/jsc/bindings/highway_{jpeg,png,webp_decoder,webp_encoder}.cpp`.

## Adding a chainable op

1. Add a field to `Pipeline` in `Image.rs` (one slot per op — setters
   overwrite, there is no op list) and a stage in `PipelineTask.applyPipeline`
   at the right point in the fixed `rotate → flip/flop → resize → modulate`
   order.
2. Add a method that parses args, writes the slot, returns `this_value`.
3. Add it to `proto:` in `Image.bind.ts`.
4. If it needs a kernel, put the C ABI in `image_resize.cpp` and the `extern`
   in `codecs.rs`.

## Adding a format

1. New `scripts/build/deps/<lib>.ts` (copy `libdeflate.ts` for the simple case).
2. Extend `Format` + `sniff()` + `mime()` in `codecs.rs`, add a `<fmt>` module with
   `decode`/`encode` functions alongside the others.
3. If the format carries EXIF, extend `exif.rs`.
4. `LICENSE.md` row.

## Invariants

- Pixel format is **RGBA8 everywhere** between decode and encode. Decoders are
  configured to emit it; encoders are fed it. Nothing branches on channels.
- **Decode** and **encode** return a `Vec<u8>`. `then()` hands the encoded one
  to JS without a copy.
- The `max_pixels` guard fires **after the header read, before the RGBA alloc**
  in every codec. New codecs must do the same.
- `image_resize.cpp` must stay in `noUnify` (see `scripts/build/unified.ts`) —
  highway's `foreach_target.h` has a TU-wide include guard that breaks with
  two highway TUs in one bundle.
