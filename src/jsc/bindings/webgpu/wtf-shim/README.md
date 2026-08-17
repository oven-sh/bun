# wtf-shim

Bun links the JSCOnly build of WTF. On macOS that build neither installs nor
compiles WTF's Cocoa helpers: some headers are missing from the prebuilt
(`wtf/cocoa/NSTypeTraits.h`) and others are present but wrapped in
`#if PLATFORM(COCOA)`, which is never true for JSCOnly (`wtf/BlockPtr.h`,
`wtf/WeakObjCPtr.h`, ...).

The WebGPU sources imported from WebKit use those helpers, so this directory
carries copies of the header-only ones. It is placed on the include path
*before* the WebKit include directory, only for the sources under `webgpu/`,
so `#include <wtf/BlockPtr.h>` in them resolves here. Each copy is the
upstream header with the `PLATFORM(COCOA)` guard replaced by `OS(DARWIN)`;
nothing else is changed, so a diff against `vendor/WebKit/Source/WTF/wtf/`
shows exactly that.

Everything here goes away once oven-sh/WebKit's JSCOnly build on macOS ships
these headers itself.
