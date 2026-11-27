#pragma once
#include "root.h"
#include "OwnPropertyCache.h"
#include <wtf/EnumeratedArray.h>

namespace Bun {

// `Platform` in src/node_path/lib.rs.
enum class PathPlatform : uint8_t {
    Posix,
    Win32,
};

// `Method` in src/runtime/node/path_ffi.rs.
enum class PathMethod : uint8_t {
    Normalize,
    Resolve,
};

// `path.posix` or `path.win32` of a realm, and the methods that it had when src/js/node/path.ts ran.
struct PathModuleObject {
    struct Method {
        JSC::WriteBarrier<JSC::Unknown> original;
        OwnPropertyCache current;
    };
    JSC::WriteBarrier<JSC::JSObject> object;
    EnumeratedArray<PathMethod, Method, PathMethod::Resolve> methods;
};

struct PathModule {
    EnumeratedArray<PathPlatform, PathModuleObject, PathPlatform::Win32> objects;

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        for (auto& [object, methods] : objects) {
            visitor.append(object);
            for (auto& [original, current] : methods) {
                visitor.append(original);
                current.visit(visitor);
            }
        }
    }
};

// `path.dirname(path)`, with its errors.
JSC::JSValue pathDirname(JSC::JSGlobalObject*, JSC::JSValue path);

// `path.join(first, second)`, with its errors.
JSC::JSValue pathJoin(JSC::JSGlobalObject*, JSC::JSString* first, JSC::JSString* second);

} // namespace Bun
