#include "root.h"
#include "helpers.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/CallFrame.h>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/text/WTFString.h>
#include <wtf/StdLibExtras.h>

using namespace JSC;
using namespace WebCore;

namespace Bun {

// Thread-safe process storage implementation
class ProcessStorage {
public:
    static ProcessStorage& getInstance() {
        static std::once_flag s_onceFlag;
        static ProcessStorage* s_instance = nullptr;
        
        std::call_once(s_onceFlag, []() {
            s_instance = new ProcessStorage();
        });
        
        return *s_instance;
    }
    
    void setItem(const String& key, const String& value) {
        Locker locker { m_lock };
        m_storage.set(key.isolatedCopy(), value.isolatedCopy());
    }
    
    String getItem(const String& key) {
        Locker locker { m_lock };
        auto it = m_storage.find(key);
        if (it != m_storage.end()) {
            return it->value;
        }
        return String();
    }
    
    bool removeItem(const String& key) {
        Locker locker { m_lock };
        return m_storage.remove(key);
    }
    
    void clear() {
        Locker locker { m_lock };
        m_storage.clear();
    }
    
    String getOrSetItem(const String& key, const String& defaultValue) {
        Locker locker { m_lock };
        auto it = m_storage.find(key);
        if (it != m_storage.end()) {
            return it->value;
        }
        // Item doesn't exist, set it and return the value
        String isolatedKey = key.isolatedCopy();
        String isolatedValue = defaultValue.isolatedCopy();
        m_storage.set(isolatedKey, isolatedValue);
        return isolatedValue;
    }
    
    String takeItem(const String& key) {
        Locker locker { m_lock };
        auto it = m_storage.find(key);
        if (it != m_storage.end()) {
            String value = it->value;
            m_storage.remove(it);
            return value;
        }
        return String();
    }
    
private:
    ProcessStorage() = default;
    ~ProcessStorage() = default;
    ProcessStorage(const ProcessStorage&) = delete;
    ProcessStorage& operator=(const ProcessStorage&) = delete;
    
    WTF_GUARDED_BY_LOCK(m_lock) HashMap<String, String> m_storage;
    Lock m_lock;
};

// JSFunction implementations
JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessStorageGetItem, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "getItem requires 1 argument"_s);
        return {};
    }
    
    JSValue keyValue = callFrame->uncheckedArgument(0);
    if (keyValue.isUndefinedOrNull()) {
        return JSValue::encode(jsNull());
    }
    
    String key = keyValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    String value = ProcessStorage::getInstance().getItem(key);
    if (value.isNull()) {
        return JSValue::encode(jsNull());
    }
    
    return JSValue::encode(jsString(vm, value));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessStorageSetItem, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "setItem requires 2 arguments"_s);
        return {};
    }
    
    JSValue keyValue = callFrame->uncheckedArgument(0);
    JSValue valueValue = callFrame->uncheckedArgument(1);
    
    String key = keyValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    String value = valueValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    ProcessStorage::getInstance().setItem(key, value);
    
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessStorageRemoveItem, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "removeItem requires 1 argument"_s);
        return {};
    }
    
    JSValue keyValue = callFrame->uncheckedArgument(0);
    if (keyValue.isUndefinedOrNull()) {
        return JSValue::encode(jsUndefined());
    }
    
    String key = keyValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    ProcessStorage::getInstance().removeItem(key);
    
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessStorageClear, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    ProcessStorage::getInstance().clear();
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessStorageGetOrSetItem, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 2) {
        throwTypeError(globalObject, scope, "getOrSetItem requires 2 arguments"_s);
        return {};
    }
    
    JSValue keyValue = callFrame->uncheckedArgument(0);
    JSValue defaultValue = callFrame->uncheckedArgument(1);
    
    String key = keyValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    String defaultString = defaultValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    String result = ProcessStorage::getInstance().getOrSetItem(key, defaultString);
    
    return JSValue::encode(jsString(vm, result));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionProcessStorageTakeItem, (JSGlobalObject* globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    
    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "takeItem requires 1 argument"_s);
        return {};
    }
    
    JSValue keyValue = callFrame->uncheckedArgument(0);
    if (keyValue.isUndefinedOrNull()) {
        return JSValue::encode(jsNull());
    }
    
    String key = keyValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    
    String value = ProcessStorage::getInstance().takeItem(key);
    if (value.isNull()) {
        return JSValue::encode(jsNull());
    }
    
    return JSValue::encode(jsString(vm, value));
}

// Function to create the processStorage object
JSValue constructProcessStorageObject(VM& vm, JSObject* bunObject)
{
    JSGlobalObject* globalObject = bunObject->globalObject();
    JSC::JSObject* processStorageObject = JSC::constructEmptyObject(globalObject);
    
    processStorageObject->putDirectNativeFunction(vm, globalObject, 
        JSC::Identifier::fromString(vm, "getItem"_s), 1, 
        jsFunctionProcessStorageGetItem, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
        
    processStorageObject->putDirectNativeFunction(vm, globalObject, 
        JSC::Identifier::fromString(vm, "setItem"_s), 2, 
        jsFunctionProcessStorageSetItem, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
        
    processStorageObject->putDirectNativeFunction(vm, globalObject, 
        JSC::Identifier::fromString(vm, "removeItem"_s), 1, 
        jsFunctionProcessStorageRemoveItem, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
        
    processStorageObject->putDirectNativeFunction(vm, globalObject, 
        JSC::Identifier::fromString(vm, "clear"_s), 0, 
        jsFunctionProcessStorageClear, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
        
    processStorageObject->putDirectNativeFunction(vm, globalObject, 
        JSC::Identifier::fromString(vm, "getOrSetItem"_s), 2, 
        jsFunctionProcessStorageGetOrSetItem, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
        
    processStorageObject->putDirectNativeFunction(vm, globalObject, 
        JSC::Identifier::fromString(vm, "takeItem"_s), 1, 
        jsFunctionProcessStorageTakeItem, ImplementationVisibility::Public, NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    
    return processStorageObject;
}

} // namespace Bun