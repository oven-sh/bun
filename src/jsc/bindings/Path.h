#pragma once

#include "config.h"
#include "ZigGlobalObject.h"

namespace Bun {

JSC::JSValue createNodePathBinding(Zig::GlobalObject* globalObject);

namespace NodePath {

// path.dirname(path) — throws ERR_INVALID_ARG_TYPE if `path` is not a string.
JSC::JSValue dirname(JSC::JSGlobalObject*, bool isWindows, JSC::JSValue path);

// path.join(...paths)
WTF::String join(bool isWindows, std::span<const WTF::StringView> paths);

} // namespace NodePath

} // namespace Bun
