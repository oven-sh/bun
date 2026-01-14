/*
 * Copyright (C) 2016-2019 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "IDLTypes.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/ObjectConstructor.h>

namespace WebCore {

namespace Detail {

template<typename IDLStringType>
struct IdentifierConverter;

template<> struct IdentifierConverter<IDLDOMString> {
    static String convert(JSC::JSGlobalObject& lexicalGlobalObject, const JSC::Identifier& identifier)
    {
        return identifierToString(lexicalGlobalObject, identifier);
    }
};

template<> struct IdentifierConverter<IDLByteString> {
    static String convert(JSC::JSGlobalObject& lexicalGlobalObject, const JSC::Identifier& identifier)
    {
        return identifierToByteString(lexicalGlobalObject, identifier);
    }
};

template<> struct IdentifierConverter<IDLUSVString> {
    static String convert(JSC::JSGlobalObject& lexicalGlobalObject, const JSC::Identifier& identifier)
    {
        return identifierToUSVString(lexicalGlobalObject, identifier);
    }
};

}

template<typename K, typename V> struct Converter<IDLRecord<K, V>> : DefaultConverter<IDLRecord<K, V>> {
    using ReturnType = typename IDLRecord<K, V>::ImplementationType;
    using KeyType = typename K::ImplementationType;
    using ValueType = typename V::ImplementationType;

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, JSDOMGlobalObject& globalObject)
    {
        return convertRecord<JSDOMGlobalObject&>(lexicalGlobalObject, value, globalObject);
    }

    static ReturnType convert(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
    {
        return convertRecord(lexicalGlobalObject, value);
    }

private:
    template<class... Args>
    static ReturnType convertRecord(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value, Args... args)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);

        // 1. Let result be a new empty instance of record<K, V>.
        // 2. If Type(O) is Undefined or Null, return result.
        if (value.isUndefinedOrNull())
            return {};

        // 3. If Type(O) is not Object, throw a TypeError.
        if (!value.isObject()) {
            throwTypeError(&lexicalGlobalObject, scope);
            return {};
        }

        JSC::JSObject* object = JSC::asObject(value);

        ReturnType result;
        HashMap<KeyType, size_t> resultMap;

        bool canUseFastPath = false;
        JSC::Structure* structure = nullptr;

        switch (object->type()) {
        case ObjectType:
        case FinalObjectType: {
            structure = object->structure();
            canUseFastPath = structure->canPerformFastPropertyEnumeration() && !structure->hasNonReifiedStaticProperties();

            if (canUseFastPath) {
                JSValue prototype = object->getPrototypeDirect();

                if (!(prototype == lexicalGlobalObject.objectPrototype() || prototype.structureOrNull() == lexicalGlobalObject.nullPrototypeObjectStructure())) {
                    canUseFastPath = false;
                }
            }
            break;
        }
        default: {
            break;
        }
        }

        if (canUseFastPath) {
            structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                if (entry.attributes() & PropertyAttribute::DontEnum) {
                    return true;
                }

                // 1. Let typedKey be key converted to an IDL value of type K.
                auto typedKey = Detail::IdentifierConverter<K>::convert(lexicalGlobalObject, Identifier::fromUid(vm, entry.key()));
                RETURN_IF_EXCEPTION(scope, false);

                // 2. Let value be ? Get(O, key).
                JSC::JSValue value = object->getDirect(entry.offset());
                scope.assertNoException();

                // 3. Let typedValue be value converted to an IDL value of type V.
                auto typedValue = Converter<V>::convert(lexicalGlobalObject, value, args...);
                RETURN_IF_EXCEPTION(scope, false);

                // 4. Set result[typedKey] to typedValue.
                // Note: It's possible that typedKey is already in result if K is USVString and key contains unpaired surrogates.
                if constexpr (std::is_same_v<K, IDLUSVString>) {
                    if (!typedKey.is8Bit()) {
                        auto addResult = resultMap.add(typedKey, result.size());
                        if (!addResult.isNewEntry) {
                            ASSERT(result[addResult.iterator->value].key == typedKey);
                            result[addResult.iterator->value].value = WTF::move(typedValue);
                            return true;
                        }
                    }
                } else
                    UNUSED_VARIABLE(resultMap);

                // 5. Otherwise, append to result a mapping (typedKey, typedValue).
                result.append({ WTF::move(typedKey), WTF::move(typedValue) });
                return true;
            });

            RETURN_IF_EXCEPTION(scope, {});

            return result;
        }

        // 4. Let keys be ? O.[[OwnPropertyKeys]]().
        JSC::PropertyNameArrayBuilder keys(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
        object->methodTable()->getOwnPropertyNames(object, &lexicalGlobalObject, keys, JSC::DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, {});

        // 5. Repeat, for each element key of keys in List order:
        for (auto& key : keys) {
            // 1. Let desc be ? O.[[GetOwnProperty]](key).
            JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
            bool hasProperty = object->methodTable()->getOwnPropertySlot(object, &lexicalGlobalObject, key, slot);
            RETURN_IF_EXCEPTION(scope, {});

            // 2. If desc is not undefined and desc.[[Enumerable]] is true:

            // It's necessary to filter enumerable here rather than using DontEnumPropertiesMode::Exclude,
            // to prevent an observable extra [[GetOwnProperty]] operation in the case of ProxyObject records.
            if (hasProperty && !(slot.attributes() & JSC::PropertyAttribute::DontEnum)) {
                // 1. Let typedKey be key converted to an IDL value of type K.
                auto typedKey = Detail::IdentifierConverter<K>::convert(lexicalGlobalObject, key);
                RETURN_IF_EXCEPTION(scope, {});

                // 2. Let value be ? Get(O, key).
                JSC::JSValue subValue;
                if (!slot.isTaintedByOpaqueObject()) [[likely]]
                    subValue = slot.getValue(&lexicalGlobalObject, key);
                else
                    subValue = object->get(&lexicalGlobalObject, key);
                RETURN_IF_EXCEPTION(scope, {});

                // 3. Let typedValue be value converted to an IDL value of type V.
                auto typedValue = Converter<V>::convert(lexicalGlobalObject, subValue, args...);
                RETURN_IF_EXCEPTION(scope, {});

                // 4. Set result[typedKey] to typedValue.
                // Note: It's possible that typedKey is already in result if K is USVString and key contains unpaired surrogates.
                if constexpr (std::is_same_v<K, IDLUSVString>) {
                    if (!typedKey.is8Bit()) {
                        auto addResult = resultMap.add(typedKey, result.size());
                        if (!addResult.isNewEntry) {
                            ASSERT(result[addResult.iterator->value].key == typedKey);
                            result[addResult.iterator->value].value = WTF::move(typedValue);
                            continue;
                        }
                    }
                } else
                    UNUSED_VARIABLE(resultMap);

                // 5. Otherwise, append to result a mapping (typedKey, typedValue).
                result.append({ WTF::move(typedKey), WTF::move(typedValue) });
            }
        }

        // 6. Return result.
        return result;
    }
};

template<typename K, typename V> struct JSConverter<IDLRecord<K, V>> {
    static constexpr bool needsState = true;
    static constexpr bool needsGlobalObject = true;

    template<typename MapType>
    static JSC::JSValue convert(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const MapType& map)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);

        // 1. Let result be ! ObjectCreate(%ObjectPrototype%).
        auto result = constructEmptyObject(&lexicalGlobalObject, globalObject.objectPrototype());

        // 2. Repeat, for each mapping (key, value) in D:
        for (const auto& keyValuePair : map) {
            // 1. Let esKey be key converted to an ECMAScript value.
            // Note, this step is not required, as we need the key to be
            // an Identifier, not a JSValue.

            // 2. Let esValue be value converted to an ECMAScript value.
            auto esValue = toJS<V>(lexicalGlobalObject, globalObject, keyValuePair.value);

            // 3. Let created be ! CreateDataProperty(result, esKey, esValue).
            bool created = result->putDirect(vm, JSC::Identifier::fromString(vm, keyValuePair.key), esValue);

            // 4. Assert: created is true.
            ASSERT_UNUSED(created, created);
        }

        // 3. Return result.
        return result;
    }
};

} // namespace WebCore
