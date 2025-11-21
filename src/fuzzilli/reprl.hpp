#pragma once

#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "wtf/Ref.h"
#include <string_view>

namespace bun::fuzzilli {

class Reprl {
public:
    Reprl();
    ~Reprl();

    int execute(std::string_view script);
    void reset();

private:
    Ref<JSC::VM> m_vm;
    JSC::JSGlobalObject* m_globalObject;
};

} // namespace bun::fuzzilli
