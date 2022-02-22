#pragma once

#include "BunBuiltinNames.h"
#include "root.h"
#include <JavaScriptCore/BuiltinUtils.h>
#include <wtf/HashSet.h>
#include <wtf/RefPtr.h>

namespace Bun {
using namespace JSC;

class JSVMClientData : public JSC::VM::ClientData {
    WTF_MAKE_NONCOPYABLE(JSVMClientData);
    WTF_MAKE_FAST_ALLOCATED;

public:
    explicit JSVMClientData(JSC::VM&);

    virtual ~JSVMClientData();

    static void create(JSC::VM*);

    BunBuiltinNames& builtinNames() { return m_builtinNames; }

    // Vector<JSC::IsoSubspace *> &outputConstraintSpaces() { return m_outputConstraintSpaces; }

    // template <typename Func> void forEachOutputConstraintSpace(const Func &func) {
    //   for (auto *space : m_outputConstraintSpaces) func(*space);
    // }

private:
    BunBuiltinNames m_builtinNames;

    // Vector<JSC::IsoSubspace *> m_outputConstraintSpaces;
};

static JSVMClientData* clientData(JSC::VM& vm)
{
    return static_cast<Bun::JSVMClientData*>(vm.clientData);
}

} // namespace Bun
