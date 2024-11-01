#pragma once

namespace Bun {

JSC::JSValue getIfPropertyExistsPrototypePollutionMitigation(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name);

/**
 * This is `JSObject::getIfPropertyExists`, except it stops when it reaches globalObject->objectPrototype().
 *
 * This means that for a prototype pollution attack to work, they would need to modify the specific prototype instead of the generic one shared by most objects.
 *
 * This method also does not support index properties.
 */
JSC::JSValue getIfPropertyExistsPrototypePollutionMitigation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, const JSC::PropertyName& name);

}
