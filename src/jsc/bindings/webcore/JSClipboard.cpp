/*
    This file is part of the WebKit open source project.

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#include "config.h"
#include "JSClipboard.h"

#include "ActiveDOMObject.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSClipboardItem.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperationReturningPromise.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>

namespace WebCore {
using namespace JSC;

// Implemented in Rust (src/runtime/webcore/clipboard.rs): the promise entry
// points settle from Bun's work pool, and the capability predicates keep the
// platform backend the single source of truth for what it can do.
extern "C" JSC::EncodedJSValue Bun__Clipboard__readText(JSC::JSGlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Clipboard__writeText(JSC::JSGlobalObject*, const BunString*);
extern "C" JSC::EncodedJSValue Bun__Clipboard__read(JSC::JSGlobalObject*);
// Takes the promise `write()` already returned; the job owns it from that point and
// settles it when the platform write finishes.
extern "C" void Bun__Clipboard__writeBlobs(JSC::JSGlobalObject*, JSC::EncodedJSValue promise, JSC::EncodedJSValue mimesArray, JSC::EncodedJSValue blobsArray);
extern "C" bool Bun__Clipboard__supportsType(const BunString*);
extern "C" bool Bun__Clipboard__writesSingleRepresentation();
extern "C" bool Bun__Clipboard__blobNeedsToReadFile(JSC::EncodedJSValue blob);

bool clipboardSupportsType(const WTF::String& type)
{
    // MIME types are compared by their lowercased serialization.
    auto lowered = type.convertToASCIILowercase();
    auto typeString = Bun::toString(lowered);
    return Bun__Clipboard__supportsType(&typeString);
}

// Attributes and functions

static JSC_DECLARE_CUSTOM_GETTER(jsClipboardConstructor);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_readText);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_writeText);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_read);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_write);

class JSClipboardPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSClipboardPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSClipboardPrototype* ptr = new (NotNull, JSC::allocateCell<JSClipboardPrototype>(vm)) JSClipboardPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSClipboardPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardPrototype, JSClipboardPrototype::Base);

using JSClipboardDOMConstructor = JSDOMConstructorNotConstructable<JSClipboard>;

template<> const ClassInfo JSClipboardDOMConstructor::s_info = { "Clipboard"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardDOMConstructor) };

template<> JSValue JSClipboardDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return JSEventTarget::getConstructor(vm, &globalObject);
}

template<> void JSClipboardDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "Clipboard"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSClipboard::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

/* Hash table for prototype */

static const HashTableValue JSClipboardPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsClipboardConstructor, 0 } },
    { "readText"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_readText, 0 } },
    { "writeText"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_writeText, 1 } },
    { "read"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_read, 0 } },
    { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_write, 1 } },
};

const ClassInfo JSClipboardPrototype::s_info = { "Clipboard"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardPrototype) };

void JSClipboardPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSClipboard::info(), JSClipboardPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSClipboard::s_info = { "Clipboard"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboard) };

JSClipboard::JSClipboard(Structure* structure, JSDOMGlobalObject& globalObject, Ref<Clipboard>&& impl)
    : JSEventTarget(structure, globalObject, WTF::move(impl))
{
}

void JSClipboard::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSObject* JSClipboard::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSClipboardPrototype::create(vm, &globalObject, JSClipboardPrototype::createStructure(vm, &globalObject, JSEventTarget::prototype(vm, globalObject)));
}

JSObject* JSClipboard::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSClipboard>(vm, globalObject);
}

JSValue JSClipboard::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSClipboardDOMConstructor, DOMConstructorID::Clipboard>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardConstructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSClipboardPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSClipboard::getConstructor(JSC::getVM(lexicalGlobalObject), prototype->globalObject()));
}

// ─── readText / writeText ───────────────────────────────────────────────────

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_readTextBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame*, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter)
{
    return Bun__Clipboard__readText(lexicalGlobalObject);
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_readText, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::callReturningOwnPromise<jsClipboardPrototypeFunction_readTextBody>(*lexicalGlobalObject, *callFrame, "readText"_s);
}

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_writeTextBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    // A promise-returning operation converts argument failures to rejections.
    if (callFrame->argumentCount() < 1) [[unlikely]] {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
    }
    auto text = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    if (throwScope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
    auto textString = Bun::toString(text);
    RELEASE_AND_RETURN(throwScope, Bun__Clipboard__writeText(lexicalGlobalObject, &textString));
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_writeText, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::callReturningOwnPromise<jsClipboardPrototypeFunction_writeTextBody>(*lexicalGlobalObject, *callFrame, "writeText"_s);
}

// ─── read / write ───────────────────────────────────────────────────────────

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_readBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame*, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter)
{
    // The Rust job reads every supported representation and resolves with
    // `[ClipboardItem]` (or `[]`), so nothing is left to chain here.
    return Bun__Clipboard__read(lexicalGlobalObject);
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_read, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::callReturningOwnPromise<jsClipboardPrototypeFunction_readBody>(*lexicalGlobalObject, *callFrame, "read"_s);
}

static JSC::EncodedJSValue rejectedWithNotAllowed(JSC::JSGlobalObject* globalObject, const WTF::String& message)
{
    return JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, createDOMException(globalObject, WebCore::ExceptionCode::NotAllowedError, message)));
}

// The write loop's state is a plain JSArray (no bespoke cell). Blobs occupy the leading N
// slots so the same array is handed to the Rust job as its blobs array; the Rust iterator
// is driven by the N-element mimes array and never reads the trailing bookkeeping slots.
//   [0 .. N)  materialized Blob per representation, index-aligned with item->types()
//   [N]       JSClipboardItem
//   [N+1]     JSPromise — the promise write() returned
//   [N+2]     jsNumber(index) — how many representations are materialized
static constexpr unsigned kClipboardWriteTrailing = 3;

static ALWAYS_INLINE unsigned clipboardWriteBlobCount(JSC::JSArray* state)
{
    return state->length() - kClipboardWriteTrailing;
}

static ALWAYS_INLINE Bun::JSClipboardItem* clipboardWriteItem(JSC::JSGlobalObject* globalObject, JSC::JSArray* state)
{
    return uncheckedDowncast<Bun::JSClipboardItem>(state->getDirectIndex(globalObject, clipboardWriteBlobCount(state)));
}

static ALWAYS_INLINE JSC::JSPromise* clipboardWritePromise(JSC::JSGlobalObject* globalObject, JSC::JSArray* state)
{
    return uncheckedDowncast<JSC::JSPromise>(state->getDirectIndex(globalObject, clipboardWriteBlobCount(state) + 1));
}

static ALWAYS_INLINE unsigned clipboardWriteIndex(JSC::JSGlobalObject* globalObject, JSC::JSArray* state)
{
    return state->getDirectIndex(globalObject, clipboardWriteBlobCount(state) + 2).asUInt32();
}

// The last step of a write: every representation is a Blob now, so hand the whole item to
// the Rust job, which snapshots the bytes, performs one platform clipboard transaction and
// settles the promise.
static void clipboardWriteFinish(JSC::JSGlobalObject* globalObject, JSC::JSArray* state)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* promise = clipboardWritePromise(globalObject, state);
    unsigned count = clipboardWriteBlobCount(state);

    // The Rust job can only snapshot in-memory Blob bytes; writing a file-backed Blob's
    // "empty" view would be silent data loss.
    for (unsigned i = 0; i < count; i++) {
        JSValue blob = state->getDirectIndex(globalObject, i);
        if (scope.exception()) [[unlikely]] {
            promise->rejectWithCaughtException(vm, scope);
            return;
        }
        if (Bun__Clipboard__blobNeedsToReadFile(JSValue::encode(blob))) [[unlikely]] {
            throwTypeError(globalObject, scope, "Cannot write a file-backed Blob to the clipboard. Read it into memory first (`await blob.bytes()`)."_s);
            promise->rejectWithCaughtException(vm, scope);
            return;
        }
    }

    // `types` is the item's own frozen FrozenArray, index-aligned with the leading Blob
    // slots; the job only reads it, so there is no second copy to keep in sync.
    JSC::JSObject* mimesArray = clipboardWriteItem(globalObject, state)->frozenTypes(globalObject);
    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(vm, scope);
        return;
    }
    // The job owns the promise from here: it rejects rather than throws, so the only
    // exception this can leave pending is a termination, which has to keep unwinding.
    scope.release();
    Bun__Clipboard__writeBlobs(globalObject, JSValue::encode(promise), JSValue::encode(mimesArray), JSValue::encode(state));
}

// Materializes the item's representations to Blobs, left to right, and finishes the write
// once they all are. Values that cannot be thenables are normalized inline; the first one
// that can be suspends the loop on a reaction that resumes here. Re-entered once per
// awaited value, picking up at the stored index.
static void clipboardWriteStep(JSC::JSGlobalObject* globalObject, JSC::JSArray* state)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* item = clipboardWriteItem(globalObject, state);
    auto* promise = clipboardWritePromise(globalObject, state);
    unsigned count = clipboardWriteBlobCount(state);
    unsigned index = clipboardWriteIndex(globalObject, state);
    const auto& types = item->types();

    while (index < count) {
        JSValue stored = item->valueAt(index);
        if (stored.isObject()) {
            // A Blob, a promise, or a thenable `Promise.resolve` would adopt: let the
            // engine settle it, then resume in jsClipboardHandler_onWriteBlobMaterialized.
            state->putDirectIndex(globalObject, count + 2, jsNumber(index));
            if (scope.exception()) [[unlikely]] {
                promise->rejectWithCaughtException(vm, scope);
                return;
            }
            auto* settled = JSC::JSPromise::resolvedPromise(globalObject, stored);
            if (scope.exception()) [[unlikely]] {
                promise->rejectWithCaughtException(vm, scope);
                return;
            }
            auto* zigGlobal = defaultGlobalObject(globalObject);
            settled->performPromiseThenWithContext(vm, globalObject,
                zigGlobal->m_clipboardOnWriteBlobMaterialized.get(globalObject),
                zigGlobal->m_clipboardOnWriteBlobFailed.get(globalObject),
                jsUndefined(), state);
            scope.assertNoException();
            return;
        }
        JSValue blob = Bun::clipboardDataToBlob(globalObject, stored, types[index]);
        if (scope.exception()) [[unlikely]] {
            promise->rejectWithCaughtException(vm, scope);
            return;
        }
        state->putDirectIndex(globalObject, index, blob);
        if (scope.exception()) [[unlikely]] {
            promise->rejectWithCaughtException(vm, scope);
            return;
        }
        index++;
    }
    scope.release();
    clipboardWriteFinish(globalObject, state);
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardHandler_onWriteBlobMaterialized, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* state = uncheckedDowncast<JSC::JSArray>(callFrame->argument(1));
    auto* item = clipboardWriteItem(globalObject, state);
    auto* promise = clipboardWritePromise(globalObject, state);
    unsigned count = clipboardWriteBlobCount(state);
    unsigned index = clipboardWriteIndex(globalObject, state);

    JSValue blob = Bun::clipboardDataToBlob(globalObject, callFrame->argument(0), item->types()[index]);
    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(vm, scope);
        return JSValue::encode(jsUndefined());
    }
    state->putDirectIndex(globalObject, index, blob);
    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(vm, scope);
        return JSValue::encode(jsUndefined());
    }
    state->putDirectIndex(globalObject, count + 2, jsNumber(index + 1));
    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(vm, scope);
        return JSValue::encode(jsUndefined());
    }
    clipboardWriteStep(globalObject, state);
    // Everything below rejects rather than throws, so only a termination reaches here;
    // it has to keep unwinding rather than be reported as a normal return.
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardHandler_onWriteBlobFailed, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* state = uncheckedDowncast<JSC::JSArray>(callFrame->argument(1));
    // A representation that never arrived rejects the write with the same reason.
    clipboardWritePromise(globalObject, state)->reject(vm, callFrame->argument(0));
    scope.assertNoException();
    return JSValue::encode(jsUndefined());
}

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_writeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) [[unlikely]] {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
    }

    // WebIDL `sequence<ClipboardItem>`: any iterable, every element branded.
    JSC::MarkedArgumentBuffer items;
    JSC::forEachInIterable(lexicalGlobalObject, callFrame->uncheckedArgument(0), [&items](JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue nextItem) {
        items.append(nextItem);
    });
    if (throwScope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
    if (items.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
    }
    for (size_t i = 0; i < items.size(); i++) {
        if (!dynamicDowncast<Bun::JSClipboardItem>(items.at(i))) [[unlikely]] {
            throwTypeError(lexicalGlobalObject, throwScope, "Clipboard.prototype.write expects a sequence of ClipboardItem"_s);
            return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
        }
    }
    if (items.size() == 0)
        RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::JSPromise::resolvedPromise(lexicalGlobalObject, jsUndefined())));
    if (items.size() > 1)
        RELEASE_AND_RETURN(throwScope, rejectedWithNotAllowed(lexicalGlobalObject, "Writing multiple ClipboardItems is not supported."_s));

    auto* item = dynamicDowncast<Bun::JSClipboardItem>(items.at(0));
    const auto& types = item->types();
    // Per spec, a representation the implementation cannot write rejects the
    // whole write, before anything is written.
    for (const auto& type : types) {
        if (!clipboardSupportsType(type))
            RELEASE_AND_RETURN(throwScope, rejectedWithNotAllowed(lexicalGlobalObject, makeString("The type \""_s, type, "\" is not supported on this platform."_s)));
    }
    if (Bun__Clipboard__writesSingleRepresentation() && types.size() > 1)
        RELEASE_AND_RETURN(throwScope, rejectedWithNotAllowed(lexicalGlobalObject, "Writing more than one representation per item is not supported on this platform."_s));

    auto* promise = JSC::JSPromise::create(vm, lexicalGlobalObject->promiseStructure());
    unsigned count = static_cast<unsigned>(types.size());
    JSC::JSArray* state = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, count + kClipboardWriteTrailing);
    if (throwScope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
    state->putDirectIndex(lexicalGlobalObject, count, item);
    state->putDirectIndex(lexicalGlobalObject, count + 1, promise);
    state->putDirectIndex(lexicalGlobalObject, count + 2, jsNumber(0u));
    if (throwScope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(lexicalGlobalObject, throwScope));
    clipboardWriteStep(lexicalGlobalObject, state);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(promise));
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::callReturningOwnPromise<jsClipboardPrototypeFunction_writeBody>(*lexicalGlobalObject, *callFrame, "write"_s);
}

// ─── plumbing ───────────────────────────────────────────────────────────────

JSC::GCClient::IsoSubspace* JSClipboard::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSClipboard, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForClipboard.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForClipboard = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForClipboard.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForClipboard = std::forward<decltype(space)>(space); });
}

void JSClipboard::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSClipboard>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    if (thisObject->scriptExecutionContext())
        analyzer.setLabelForCell(cell, makeString("url "_s, thisObject->scriptExecutionContext()->url().string()));
    Base::analyzeHeap(cell, analyzer);
}

bool JSClipboardOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    auto* jsClipboard = uncheckedDowncast<JSClipboard>(handle.slot()->asCell());
    ScriptExecutionContext* owner = WTF::getPtr(jsClipboard->wrapped().scriptExecutionContext());
    if (!owner)
        return false;
    if (reason) [[unlikely]]
        *reason = "Reachable from ScriptExecutionContext"_s;
    return visitor.containsOpaqueRoot(&jsClipboard->wrapped());
}

void JSClipboardOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsClipboard = static_cast<JSClipboard*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsClipboard->wrapped(), jsClipboard);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Clipboard>&& impl)
{
    return createWrapper<Clipboard>(globalObject, WTF::move(impl));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Clipboard& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

} // namespace WebCore

// ─── entry points for the Rust backend ──────────────────────────────────────

// Fired after a successful write ("copy") or read ("paste") at the
// `navigator.clipboard` EventTarget (a runtime has no focused element). Like
// `Process__dispatchOnBeforeExit`, the dispatch machinery owns exceptions.
extern "C" void Bun__Clipboard__fireEvent(JSC::JSGlobalObject* globalObject, bool isCopy)
{
    auto* global = defaultGlobalObject(globalObject);
    // Nothing can be listening if `navigator.clipboard` was never created.
    if (!global->m_clipboardInstance.isInitialized())
        return;
    auto* wrapper = WTF::dynamicDowncast<WebCore::JSClipboard>(global->m_clipboardInstance.getInitializedOnMainThread(global));
    if (!wrapper || !wrapper->wrapped().hasEventListeners())
        return;
    wrapper->wrapped().fireClipboardEvent(isCopy ? WTF::AtomString("copy"_s) : WTF::AtomString("paste"_s));
}

// Builds the `"NotAllowedError"` DOMException the clipboard promises reject
// with; the Rust side has no DOMException constructor of its own.
extern "C" JSC::EncodedJSValue Bun__Clipboard__createNotAllowedError(JSC::JSGlobalObject* globalObject, const BunString* message)
{
    return JSC::JSValue::encode(WebCore::createDOMException(globalObject, WebCore::ExceptionCode::NotAllowedError, message->toWTFString(BunString::ZeroCopy)));
}
