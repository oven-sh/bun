// CGContextDrawImage takes a CGRect (4× double, 32 bytes) by value. On
// arm64 Darwin that's an HFA passed in v0–v3 and Zig's function-pointer call
// lays it out correctly; on x86_64 SysV it's MEMORY-class (caller-pushed onto
// the stack), and calling through the dlsym'd pointer from Zig segfaults on
// macOS 13/14 x64 CI. Route the one struct-by-value call through this TU
// instead — clang emits the SysV struct push correctly, and the Zig→C
// boundary becomes (ptr, ptr, ptr, 4× double), all register-passed on both
// arches.
//
// We keep dlsym for *resolution* (so the binary doesn't grow a load-command
// dependency on CoreGraphics) and only thunk the ABI-tricky call.

#if defined(__APPLE__)

extern "C" {

struct BunCGRect {
    double x, y, w, h;
};

using CFRef = void*;
using DrawImageFn = void (*)(CFRef, BunCGRect, CFRef);

void bun_CGContextDrawImage(void* fn, CFRef ctx, CFRef img, double x, double y, double w, double h)
{
    reinterpret_cast<DrawImageFn>(fn)(ctx, BunCGRect { x, y, w, h }, img);
}

} // extern "C"

#else
// Non-Apple: emit a stub so the symbol exists at link time on every target
// (Zig references it under `if (Environment.isMac)` but the linker still
// wants a definition until LTO drops it).
extern "C" void bun_CGContextDrawImage(void*, void*, void*, double, double, double, double) {}
#endif
