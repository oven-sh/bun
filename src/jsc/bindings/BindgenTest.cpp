// The C++ of `TestMemberCalls` in bindgen_test.bind.ts, which only a build with assertions has.
#include "root.h"

#if ASSERT_ENABLED || defined(BUN_DEBUG)

#include "GeneratedBindgenTest.h"
#include <JavaScriptCore/Error.h>

namespace Bun::Bindgen::Generated {

using namespace JSC;

JSValue JSTestMemberCalls::runInCpp(int32_t n, bool fail)
{
    auto* globalObject = this->globalObject();
    auto scope = DECLARE_THROW_SCOPE(vm());
    if (fail) {
        this->fail(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue twiceN = twice(globalObject, n);
    RETURN_IF_EXCEPTION(scope, {});
    static constexpr std::array<uint8_t, 3> bytes { 1, 2, 3 };
    JSValue total = sum(globalObject, bytes);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue ofNothing = sum(globalObject, {});
    RETURN_IF_EXCEPTION(scope, {});
    return jsNumber(twiceN.asInt32() * 1000 + total.asInt32() * 10 + ofNothing.asInt32() + calls());
}

void JSTestMemberCalls::noteInCpp(JSValue value)
{
    m_note.set(vm(), this, value);
}

void JSTestMemberCalls::throwInCpp()
{
    auto scope = DECLARE_THROW_SCOPE(vm());
    throwTypeError(globalObject(), scope, "thrown in C++"_s);
}

} // namespace Bun::Bindgen::Generated

#endif
