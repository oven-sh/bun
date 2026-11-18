#include "root.h"

#include "DesktopRealm.h"
#include "IsolatedWorld.h"
#include "JSDOMFormData.h"
#include "RemovableFeatures.h"
#include "WebGlobalObject.h"
#include "blob.h"
#include "ZigGlobalObject.h"
#include "webcore/streams/JSWritableStream.h"
#include "webcore/streams/JSWritableStreamDefaultController.h"
#include "webcore/streams/WebStreamsInternals.h"
#include <JavaScriptCore/JSPromise.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

extern "C" BunString Blob__getFileNameString(void* impl);

extern "C" void Bun__Desktop__adoptFile(JSGlobalObject* globalObject, EncodedJSValue file)
{
    desktopRealmAdoptFile(globalObject, JSValue::decode(file));
}

extern "C" SYSV_ABI bool JSDOMFile__hasInstance(EncodedJSValue, JSGlobalObject*, EncodedJSValue);
extern "C" bool Bun__DOM__fillFormData(JSGlobalObject*, EncodedJSValue data, EncodedJSValue form, EncodedJSValue submitter, bool isStrict);
extern "C" void Bun__DOM__touchBlob(void*);

static DOMFormData& entriesOf(JSValue data) { return uncheckedDowncast<JSDOMFormData>(data)->wrapped(); }

void copyEntriesToAnotherRealm(const DOMFormData& from, DOMFormData& to)
{
    for (auto& item : from.items()) {
        if (auto* text = std::get_if<String>(&item.data))
            to.append(item.name, *text);
        else if (auto& file = std::get<RefPtr<Blob>>(item.data))
            to.append(item.name, Blob::create(static_cast<void*>(file->impl())), file->fileName());
    }
}

static NEVER_INLINE void fillFormData(JSGlobalObject* realm, JSValue data, JSValue form, JSValue submitter)
{
    BUN_REMOVABLE_DEFINITION(Desktop, &fillFormData);
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    auto* page = IsolatedWorld::pageOf(realm);
    if (!page) {
        scope.release();
        Bun__DOM__fillFormData(realm, JSValue::encode(data), JSValue::encode(form), JSValue::encode(submitter), realm->inherits<WebGlobalObject>());
        return;
    }
    form = IsolatedWorld::toPage(realm, form);
    RETURN_IF_EXCEPTION(scope, );
    submitter = IsolatedWorld::toPage(realm, submitter);
    RETURN_IF_EXCEPTION(scope, );
    JSValue inPage = toJSNewlyCreated(page, page, DOMFormData::create(page->scriptExecutionContext()));
    Bun__DOM__fillFormData(page, JSValue::encode(inPage), JSValue::encode(form), JSValue::encode(submitter), true);
    if (auto* exception = scope.exception()) [[unlikely]] {
        if (!scope.tryClearException())
            return;
        JSValue error = IsolatedWorld::toWorld(realm, exception->value());
        RETURN_IF_EXCEPTION(scope, );
        throwException(realm, scope, error);
        return;
    }
    copyEntriesToAnotherRealm(entriesOf(inPage), entriesOf(data));
}

void desktopRealmFillFormData(JSGlobalObject* realm, JSValue data, JSValue form, JSValue submitter)
{
    if (!isFeatureRemoved(Feature::Desktop))
        fillFormData(realm, data, form, submitter);
}

static NEVER_INLINE void turnIntoFile(JSGlobalObject* realm, JSValue given, Blob& entry, String* name)
{
    BUN_REMOVABLE_DEFINITION(Desktop, &turnIntoFile);
    if (!realm->inherits<WebGlobalObject>() || JSDOMFile__hasInstance(encodedJSUndefined(), realm, JSValue::encode(given)))
        return;
    if (name && name->isEmpty())
        *name = "blob"_s;
    Bun__DOM__touchBlob(entry.impl());
}

void desktopRealmTurnIntoFile(JSGlobalObject* realm, JSValue given, Blob& entry, String* name)
{
    if (!isFeatureRemoved(Feature::Desktop))
        turnIntoFile(realm, given, entry, name);
}

extern "C" void Bun__DOM__appendToFormData(JSGlobalObject*, EncodedJSValue data, StringImpl* name, EncodedJSValue encodedValue)
{
    auto& entries = entriesOf(JSValue::decode(data));
    JSValue value = JSValue::decode(encodedValue);
    if (auto* other = dynamicDowncast<JSDOMFormData>(value)) {
        for (auto& item : other->wrapped().items()) {
            if (auto* text = std::get_if<String>(&item.data))
                entries.append(item.name, *text);
            else if (auto& file = std::get<RefPtr<Blob>>(item.data))
                entries.append(item.name, file, file->fileName());
        }
    } else if (value.isString())
        entries.append(name, asString(value)->tryGetValue());
    else if (auto file = Blob::create(value)) {
        file->setWrapper(asObject(value));
        entries.append(name, file, Blob__getFileNameString(file->impl()).transferToWTFString());
    }
}

extern "C" void Bun__DOM__appendTextToFormData(EncodedJSValue data, StringImpl* name, StringImpl* value)
{
    entriesOf(JSValue::decode(data)).append(name, String(value));
}

extern "C" StringImpl* Bun__DOM__entryOfFormData(EncodedJSValue data, uint32_t index, StringImpl** value, void** file)
{
    auto& items = entriesOf(JSValue::decode(data)).items();
    if (index >= items.size())
        return nullptr;
    auto* text = std::get_if<String>(&items[index].data);
    auto* blob = text ? nullptr : std::get<RefPtr<Blob>>(items[index].data).get();
    *value = String(text ? *text : blob->fileName()).releaseImpl().leakRef();
    *file = blob ? blob->impl() : nullptr;
    return String(items[index].name.isNull() ? emptyString() : items[index].name).releaseImpl().leakRef();
}

extern "C" EncodedJSValue Bun__Desktop__createFileStream(JSGlobalObject* globalObject, EncodedJSValue prototype, EncodedJSValue sink, EncodedJSValue write, EncodedJSValue close, EncodedJSValue abort)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* stream = JSWritableStream::create(vm, JSWritableStream::createStructure(vm, globalObject, JSValue::decode(prototype)));
    WebStreams::initializeWritableStream(stream);
    WebStreams::setUpWritableStreamDefaultControllerFromUnderlyingSink(globalObject, stream, JSValue::decode(sink), { {}, JSValue::decode(write), JSValue::decode(close), JSValue::decode(abort) }, 1, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    stream->putDirect(vm, builtinNames(vm).implPrivateName(), JSValue::decode(sink));
    return JSValue::encode(stream);
}

extern "C" EncodedJSValue Bun__Desktop__writeToStream(JSGlobalObject* globalObject, EncodedJSValue stream, EncodedJSValue chunk)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* writer = WebStreams::acquireWritableStreamDefaultWriter(globalObject, uncheckedDowncast<JSWritableStream>(JSValue::decode(stream)));
    RETURN_IF_EXCEPTION(scope, {});
    auto* result = WebStreams::writableStreamDefaultWriterWrite(globalObject, writer, JSValue::decode(chunk));
    RETURN_IF_EXCEPTION(scope, {});
    WebStreams::writableStreamDefaultWriterRelease(globalObject, writer);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

}
