#pragma once

#include "GeneratedBlob.h"

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

class JSS3File : public Bun::Bindgen::Generated::JSBlob {
    using Base = Bun::Bindgen::Generated::JSBlob;

public:
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    JSS3File(JSC::VM& vm, Structure* structure, void* ptr)
        : Base(vm, structure, ptr)
    {
    }
    DECLARE_INFO;

    static JSS3File* create(JSC::VM& vm, JSC::Structure* structure, void* ptr);
    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);
};

Structure* createJSS3FileStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

} // namespace Bun
