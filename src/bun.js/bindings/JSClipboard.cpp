#include "ErrorCode.h"
#include "root.h"
#include "Clipboard.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Identifier.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>
#include <mutex>
#include "ObjectBindings.h"

namespace Bun {

using namespace JSC;
using namespace WTF;

// Options struct that will be passed through the threadpool
struct ClipboardJobOptions {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(ClipboardJobOptions);

    enum Operation {
        READ_TEXT = 0,
        WRITE_TEXT = 1,
        READ_HTML = 2,
        WRITE_HTML = 3
    };

    Operation op;
    CString text; // UTF-8 encoded, thread-safe (only for WRITE operations)
    CString mimeType; // MIME type for operations

    // Results (filled in by threadpool)
    Clipboard::Error error;
    std::optional<String> resultText;

    ClipboardJobOptions(Operation op, CString&& text = CString(), CString&& mimeType = CString())
        : op(op)
        , text(text)
        , mimeType(mimeType)
    {
    }

    ~ClipboardJobOptions()
    {
        if (text.length() > 0) {
            memsetSpan(text.mutableSpan(), 0);
        }
    }

    static ClipboardJobOptions* fromJS(JSGlobalObject* globalObject, ArgList args, Operation operation)
    {
        auto& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        String text;
        String mimeType = "text/plain"_s; // default

        if (operation == WRITE_TEXT || operation == WRITE_HTML) {
            // Write operations need text content
            if (args.size() < 1) {
                Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "Expected text content"_s);
                return nullptr;
            }

            JSValue textValue = args.at(0);
            // Convert any value to string as per Web API spec
            text = textValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, nullptr);

            if (operation == WRITE_HTML) {
                mimeType = "text/html"_s;
            }
        } else if (operation == READ_HTML) {
            mimeType = "text/html"_s;
        } else {
            // READ_TEXT or other read operations might have optional type parameter
            if (args.size() > 0) {
                JSValue typeValue = args.at(0);
                if (typeValue.isString()) {
                    mimeType = typeValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, nullptr);
                }
            }
        }

        RELEASE_AND_RETURN(scope, new ClipboardJobOptions(operation, text.utf8(), mimeType.utf8()));
    }
};

extern "C" {

// Thread pool function - runs on a background thread
void Bun__ClipboardJobOptions__runTask(ClipboardJobOptions* opts, JSGlobalObject* globalObject)
{
    switch (opts->op) {
    case ClipboardJobOptions::READ_TEXT: {
        auto result = Clipboard::readText(opts->error);
        if (result.has_value()) {
            opts->resultText = result.value();
        }
        break;
    }

    case ClipboardJobOptions::WRITE_TEXT:
        opts->error = Clipboard::writeText(String::fromUTF8(opts->text.data()));
        break;

    case ClipboardJobOptions::READ_HTML: {
        auto result = Clipboard::readHTML(opts->error);
        if (result.has_value()) {
            opts->resultText = result.value();
        }
        break;
    }

    case ClipboardJobOptions::WRITE_HTML:
        opts->error = Clipboard::writeHTML(String::fromUTF8(opts->text.data()));
        break;
    }
}

// Runs on the main thread after threadpool completes - resolves the promise
void Bun__ClipboardJobOptions__runFromJS(ClipboardJobOptions* opts, JSGlobalObject* global, EncodedJSValue promiseValue)
{
    auto& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSPromise* promise = jsCast<JSPromise*>(JSValue::decode(promiseValue));

    if (opts->error.type != Clipboard::ErrorType::None) {
        String errorMessage = opts->error.message;
        if (errorMessage.isEmpty()) {
            errorMessage = "Clipboard operation failed"_s;
        }
        promise->reject(global, createError(global, errorMessage));
    } else {
        // Success cases
        switch (opts->op) {
        case ClipboardJobOptions::READ_TEXT:
        case ClipboardJobOptions::READ_HTML:
            if (opts->resultText.has_value()) {
                promise->resolve(global, jsString(vm, opts->resultText.value()));
            } else {
                promise->resolve(global, jsEmptyString(vm));
            }
            break;

        case ClipboardJobOptions::WRITE_TEXT:
        case ClipboardJobOptions::WRITE_HTML:
            promise->resolve(global, jsUndefined());
            break;
        }
    }
}

void Bun__ClipboardJobOptions__deinit(ClipboardJobOptions* opts)
{
    delete opts;
}

// Zig binding exports
void Bun__Clipboard__scheduleJob(JSGlobalObject* global, ClipboardJobOptions* opts, EncodedJSValue promise);

} // extern "C"

JSC_DEFINE_HOST_FUNCTION(jsClipboardReadText, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* options = ClipboardJobOptions::fromJS(globalObject, ArgList(callFrame), ClipboardJobOptions::READ_TEXT);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(options);

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Clipboard__scheduleJob(globalObject, options, JSValue::encode(promise));

    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardWriteText, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "clipboard.writeText requires text content"_s);
        return JSValue::encode(jsUndefined());
    }

    auto* options = ClipboardJobOptions::fromJS(globalObject, ArgList(callFrame), ClipboardJobOptions::WRITE_TEXT);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(options);

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Clipboard__scheduleJob(globalObject, options, JSValue::encode(promise));

    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardRead, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Default to reading text, but check the type parameter
    ClipboardJobOptions::Operation operation = ClipboardJobOptions::READ_TEXT;
    
    if (callFrame->argumentCount() > 0) {
        JSValue typeValue = callFrame->uncheckedArgument(0);
        if (typeValue.isString()) {
            String type = typeValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
            
            if (type == "text/html"_s) {
                operation = ClipboardJobOptions::READ_HTML;
            } else if (type != "text/plain"_s) {
                throwTypeError(globalObject, scope, makeString("Unsupported clipboard type: "_s, type));
                return JSValue::encode(jsUndefined());
            }
        }
    }

    auto* options = ClipboardJobOptions::fromJS(globalObject, ArgList(callFrame), operation);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(options);

    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Clipboard__scheduleJob(globalObject, options, JSValue::encode(promise));

    return JSValue::encode(promise);
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardWrite, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "clipboard.write() requires at least one argument"_s);
        return JSValue::encode(jsUndefined());
    }

    auto data = callFrame->uncheckedArgument(0);
    if (!data.isObject()) {
        throwTypeError(globalObject, scope, "clipboard.write() expects an array of ClipboardItem objects"_s);
        return JSValue::encode(jsUndefined());
    }

    auto* object = asObject(data);
    
    // Handle array of ClipboardItems
    if (isArray(globalObject, object)) {
        auto firstItem = object->getIndex(globalObject, 0);
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
        
        if (firstItem.isObject()) {
            object = asObject(firstItem);
        }
    }

    // Extract text/plain or text/html from the ClipboardItem
    auto textPlainValue = object->get(globalObject, Identifier::fromString(vm, "text/plain"_s));
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
    
    auto textHtmlValue = object->get(globalObject, Identifier::fromString(vm, "text/html"_s));
    RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));

    ClipboardJobOptions* options = nullptr;

    if (!textPlainValue.isUndefined() && textPlainValue.isString()) {
        // Handle text/plain
        String text = textPlainValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
        
        options = new ClipboardJobOptions(ClipboardJobOptions::WRITE_TEXT, text.utf8());
    } else if (!textHtmlValue.isUndefined() && textHtmlValue.isString()) {
        // Handle text/html
        String html = textHtmlValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
        
        options = new ClipboardJobOptions(ClipboardJobOptions::WRITE_HTML, html.utf8());
    } else {
        throwTypeError(globalObject, scope, "No supported clipboard data types found"_s);
        return JSValue::encode(jsUndefined());
    }

    ASSERT(options);
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
    Bun__Clipboard__scheduleJob(globalObject, options, JSValue::encode(promise));

    return JSValue::encode(promise);
}

JSObject* createClipboardObject(JSGlobalObject* lexicalGlobalObject)
{
    VM& vm = lexicalGlobalObject->vm();
    
    JSObject* clipboardObject = constructEmptyObject(lexicalGlobalObject, lexicalGlobalObject->objectPrototype(), 4);
    
    clipboardObject->putDirect(vm, Identifier::fromString(vm, "read"_s), 
        JSFunction::create(vm, lexicalGlobalObject, 1, "read"_s, jsClipboardRead, ImplementationVisibility::Public));
    
    clipboardObject->putDirect(vm, Identifier::fromString(vm, "write"_s), 
        JSFunction::create(vm, lexicalGlobalObject, 1, "write"_s, jsClipboardWrite, ImplementationVisibility::Public));
    
    clipboardObject->putDirect(vm, Identifier::fromString(vm, "writeText"_s), 
        JSFunction::create(vm, lexicalGlobalObject, 1, "writeText"_s, jsClipboardWriteText, ImplementationVisibility::Public));
    
    clipboardObject->putDirect(vm, Identifier::fromString(vm, "readText"_s), 
        JSFunction::create(vm, lexicalGlobalObject, 0, "readText"_s, jsClipboardReadText, ImplementationVisibility::Public));

    return clipboardObject;
}

} // namespace Bun