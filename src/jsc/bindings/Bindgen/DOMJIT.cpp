#include "root.h"
#include "Bindgen/DOMJIT.h"
#include "RemovableFeatures.h"
#include <JavaScriptCore/EmbedderListItems.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SnippetParams.h>

namespace Bun::Bindgen::DOMJIT {
using namespace JSC;

JSC_DECLARE_JIT_OPERATION_WITHOUT_WTF_INTERNAL(operationCallGetterOfEmptyField, EncodedJSValue, (JSGlobalObject*, void*));
// A slow path has this type, and the receiver knows its realm.
JSC_DEFINE_JIT_OPERATION(operationCallGetterOfEmptyField, EncodedJSValue, (JSGlobalObject * getter, void* cell))
{
    auto* thisObject = static_cast<JSObject*>(cell);
    auto* globalObject = thisObject->realm();
    BINDGEN_OPERATION_PROLOGUE(globalObject);
    OPERATION_RETURN(scope, std::bit_cast<GetValueFunc::Ptr>(getter)(globalObject, JSValue::encode(thisObject), PropertyName()));
}

static Snippet createSnippet(Effect effect, auto&& generate)
{
    Snippet snippet = JSC::DOMJIT::CallDOMGetterSnippet::create();
    snippet->requireGlobalObject = false;
    snippet->effect = effect;
    snippet->setGenerator([=](CCallHelpers& jit, SnippetParams& params) {
        generate(jit, params, params[0].gpr(), params[1].gpr());
        return CCallHelpers::JumpList();
    });
    return snippet;
}

static void callGetter(CCallHelpers::JumpList from, CCallHelpers& jit, SnippetParams& params, GetValueFunc::Ptr getter, GPRReg result, GPRReg thisObject)
{
    auto isDone = jit.jump();
    from.link(&jit);
    jit.move(CCallHelpers::TrustedImmPtr(std::bit_cast<void*>(getter)), result);
    auto call = jit.jump();
    isDone.link(&jit);
    params.addSlowPathCall(call, jit, operationCallGetterOfEmptyField, result, result, thisObject);
}

NEVER_INLINE Snippet loadFieldOrNull(unsigned offset, Effect effect)
{
    BUN_REMOVABLE_DEFINITION(JIT, loadFieldOrNull);
    return createSnippet(effect, [=](CCallHelpers& jit, SnippetParams&, GPRReg result, GPRReg thisObject) {
        jit.load64(CCallHelpers::Address(thisObject, offset), result);
        auto isThere = jit.branchIfNotEmpty(result);
        jit.moveTrustedValue(jsNull(), result);
        isThere.link(&jit);
    });
}

NEVER_INLINE Snippet loadFieldOrCall(unsigned offset, GetValueFunc::Ptr getter, Effect effect)
{
    BUN_REMOVABLE_DEFINITION(JIT, loadFieldOrCall);
    return createSnippet(effect, [=](CCallHelpers& jit, SnippetParams& params, GPRReg result, GPRReg thisObject) {
        jit.load64(CCallHelpers::Address(thisObject, offset), result);
        auto isThere = jit.branchIfNotEmpty(result);
        jit.move(CCallHelpers::TrustedImmPtr(std::bit_cast<void*>(getter)), result);
        auto isEmpty = jit.jump();
        isThere.link(&jit);
        params.addSlowPathCall(isEmpty, jit, operationCallGetterOfEmptyField, result, result, thisObject);
    });
}

NEVER_INLINE Snippet tryOrCall(Shortcut* shortcut, GetValueFunc::Ptr getter, Effect effect)
{
    BUN_REMOVABLE_DEFINITION(JIT, tryOrCall);
    Snippet snippet = createSnippet(effect, [=](CCallHelpers& jit, SnippetParams& params, GPRReg result, GPRReg thisObject) {
        auto hasFailed = shortcut(jit, result, thisObject, params.gpScratch(0));
        if (hasFailed.empty())
            return;
        callGetter(hasFailed, jit, params, getter, result, thisObject);
    });
    snippet->numGPScratchRegisters = 1;
    return snippet;
}

NEVER_INLINE Snippet loadMember(unsigned offset, Member member, Effect effect)
{
    BUN_REMOVABLE_DEFINITION(JIT, loadMember);
    return createSnippet(effect, [=](CCallHelpers& jit, SnippetParams&, GPRReg result, GPRReg thisObject) {
        CCallHelpers::Address address(thisObject, offset);
        switch (member) {
        case Member::Bool:
            jit.load8(address, result);
            jit.boxBoolean(result, result);
            return;
        case Member::U8:
            jit.load8(address, result);
            break;
        case Member::U16:
            jit.load16(address, result);
            break;
        case Member::I32:
            jit.load32(address, result);
            break;
        }
        jit.boxInt32(result, result);
    });
}

NEVER_INLINE Snippet call(Effect effect)
{
    BUN_REMOVABLE_DEFINITION(JIT, call);
    Snippet snippet = JSC::DOMJIT::CallDOMGetterSnippet::create();
    snippet->requireGlobalObject = false;
    snippet->effect = effect;
    return snippet;
}

NEVER_INLINE Snippet countItemsOrCall(GetValueFunc::Ptr getter, Effect effect)
{
    BUN_REMOVABLE_DEFINITION(JIT, countItemsOrCall);
    return createSnippet(effect, [=](CCallHelpers& jit, SnippetParams& params, GPRReg result, GPRReg thisObject) {
        CCallHelpers::JumpList hasNone;
        jit.loadPtr(CCallHelpers::Address(thisObject, EmbedderListItems::offsetOfClock()), result);
        jit.load64(CCallHelpers::Address(result), result);
        hasNone.append(jit.branch64(CCallHelpers::NotEqual, CCallHelpers::Address(thisObject, EmbedderListItems::offsetOfTime()), result));
        jit.loadPtr(CCallHelpers::Address(thisObject, EmbedderListItems::offsetOfItems()), result);
        hasNone.append(jit.branchTestPtr(CCallHelpers::Zero, result));
        static_assert(IndexingHeader::maximumLength <= std::numeric_limits<int32_t>::max());
        jit.load32(CCallHelpers::Address(result, JSCellButterfly::offsetOfPublicLength()), result);
        jit.boxInt32(result, result);
        callGetter(hasNone, jit, params, getter, result, thisObject);
    });
}

}
