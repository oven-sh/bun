# `Bun.Image`

Sharp-shaped image pipeline. Decode → (auto-orient) → transform* → encode, all
off the JS thread.

## Layout

| file | owns | touch when |
|---|---|---|
| `Image.classes.ts` | JS surface (codegen input) | adding/renaming a JS method |
| `Image.zig` | JS↔Zig glue: arg parsing, op recording, `ConcurrentPromiseTask` scheduling, result delivery | new options, new chainable, new terminal |
| `codecs.zig` | thin `extern fn` wrappers over libjpeg-turbo / libspng / libwebp + the `Format` sniffer + the pixel-limit guard | bumping a codec, adding a format |
| `exif.zig` | JPEG APP1/TIFF Orientation reader (tag 0x0112 only) | extending EXIF coverage |
| `../bun.js/bindings/image_resize.cpp` | highway resize/rotate/flip kernels (`bun_image_*` C ABI) | new filter, perf work |

The codecs themselves are vendored via `scripts/build/deps/{libjpeg-turbo,libspng,libwebp}.ts`.
`patches/libjpeg-turbo/` carries the 8-bit-only patch + the j12/j16 stub overlay.

## Adding a chainable op

1. Add a variant to `Op` in `Image.zig` and a case in `PipelineTask.run`'s
   `for (this.ops)` switch.
2. Add a `do<Name>` method that parses args, `pushOp`s, returns `callframe.this()`.
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
- Every `[]u8` returned to `Image.zig` is owned by `bun.default_allocator` so
  it can be handed to `JSUint8Array.fromBytes` or `Blob.init` without a custom
  finalizer. C-allocated buffers are dup'd then freed at the boundary.
- The `max_pixels` guard fires **after the header read, before the RGBA alloc**
  in every codec. New codecs must do the same.
- `image_resize.cpp` must stay in `noUnify` (see `scripts/build/unified.ts`) —
  highway's `foreach_target.h` has a TU-wide include guard that breaks with
  two highway TUs in one bundle.
