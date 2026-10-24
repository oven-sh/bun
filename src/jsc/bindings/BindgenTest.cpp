// The C++ of `TestMemberFunctions` in bindgen_test.bind.ts, which only a build with assertions has.
#include "root.h"

#if ASSERT_ENABLED || defined(BUN_DEBUG)

#include "GeneratedBindgenTest.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>

namespace Bun::Bindgen::Generated {

using namespace JSC;

JSValue JSTestMemberFunctions::runInCpp(JSGlobalObject* globalObject, JSValue n, bool fail)
{
    auto scope = DECLARE_THROW_SCOPE(vm());
    if (fail) {
        failInRust(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSValue twiceN = twice(globalObject, n);
    RETURN_IF_EXCEPTION(scope, {});
    static constexpr std::array<uint8_t, 3> bytes { 1, 2, 3 };
    MarkedArgumentBuffer results;
    results.append(twiceN);
    results.append(jsNumber(sum(bytes)));
    results.append(jsNumber(sum({})));
    results.append(jsNumber(callCount()));
    ASSERT(!results.hasOverflowed());
    RELEASE_AND_RETURN(scope, constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), results));
}

void JSTestMemberFunctions::setNoteInCpp(JSValue value)
{
    m_note.set(vm(), this, value);
}

JSValue JSTestMemberFunctions::noteInCpp()
{
    return m_note.get();
}

void JSTestMemberFunctions::failInCpp(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm());
    throwTypeError(globalObject, scope, "thrown in C++"_s);
}

JSValue JSTestMemberFunctions::promiseInCpp(JSGlobalObject* globalObject)
{
    if (!m_promise)
        m_promise.set(vm(), this, JSPromise::create(vm(), globalObject->promiseStructure()));
    return m_promise.get();
}

} // namespace Bun::Bindgen::Generated

#endif
