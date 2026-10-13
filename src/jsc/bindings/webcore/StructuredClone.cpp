/*
 * Copyright (C) 2016 Apple Inc. All Rights Reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */

#include "config.h"
#include "StructuredClone.h"

#include "JSDOMBinding.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/JSArrayInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ObjectConstructorInlines.h>
#include "SerializedScriptValue.h"
#include "MessagePort.h"
#include "JSStructuredSerializeOptions.h"
#include <wtf/SetForScope.h>

namespace WebCore {
using namespace JSC;

// Copies a tree of plain objects, dense arrays and primitives without running script or throwing; anything else in it ends the attempt, and the caller serializes.
class PlainTreeCloner {
public:
    PlainTreeCloner(VM& vm, JSGlobalObject* globalObject)
        : m_vm(vm)
        , m_globalObject(globalObject)
    {
    }

    // The clone, or an empty value when the tree holds something else.
    JSValue clone(JSValue value)
    {
        if (!value.isCell())
            return value;
        JSCell* cell = value.asCell();
        if (cell->isString())
            return value;
        if (!cell->isObject())
            return {};
        JSObject* object = asObject(cell);
        if (JSObject* existing = cloneOf(object))
            return existing;
        if (m_depth == maximumDepth || !m_vm.isSafeToRecurse()) [[unlikely]]
            return {};
        SetForScope depth(m_depth, m_depth + 1);
        switch (object->type()) {
        case FinalObjectType:
            return cloneObject(object);
        case ArrayType:
            return cloneArray(uncheckedDowncast<JSArray>(object));
        default:
            return {};
        }
    }

private:
    JSValue cloneObject(JSObject* object)
    {
        Structure* structure = object->structure();
        if (!structure->canPerformFastPropertyEnumerationCommon() || !structure->hasInlineStorage())
            return {};
        // Succeeds only when every own property is a plain data property with a string key and the prototype is this global's Object.prototype.
        JSObject* clone = tryCreateObjectViaCloning(m_vm, m_globalObject, object);
        if (!clone) {
            // An object that never had a property is refused as well: it has no structure worth sharing.
            if (structure->didTransition() || structure->maxOffset() != invalidOffset || !checkStructureForClone(structure) || structure->realm() != m_globalObject || structure->storedPrototype() != m_globalObject->objectPrototype())
                return {};
            clone = constructEmptyObject(m_globalObject);
        }
        remember(object, clone);

        PropertyOffset maxOffset = structure->maxOffset();
        PropertyOffset inlineEnd = std::min<PropertyOffset>(maxOffset + 1, structure->inlineCapacity());
        for (PropertyOffset offset = 0; offset < inlineEnd; ++offset) {
            if (!cloneProperty(object, clone, offset))
                return {};
        }
        for (PropertyOffset offset = firstOutOfLineOffset; offset <= maxOffset; ++offset) {
            if (!cloneProperty(object, clone, offset))
                return {};
        }
        return clone;
    }

    // The slot already holds what the source holds. Only an object in it has to be replaced by its clone.
    bool cloneProperty(JSObject* object, JSObject* clone, PropertyOffset offset)
    {
        JSValue value = object->getDirect(offset);
        if (!value || !value.isCell() || value.asCell()->isString())
            return true;
        JSValue cloned = this->clone(value);
        if (!cloned)
            return false;
        clone->putDirectOffset(m_vm, offset, cloned);
        return true;
    }

    JSValue cloneArray(JSArray* array)
    {
        // No named property, Array.prototype of this global, and no hole to read through to it.
        Structure* structure = array->structure();
        if (!m_globalObject->isOriginalArrayStructure(structure))
            return {};
        IndexingType shape = structure->indexingType() & IndexingShapeMask;
        if (shape != UndecidedShape && shape != Int32Shape && shape != DoubleShape && shape != ContiguousShape)
            return {};
        unsigned length = array->length();
        if (shape == UndecidedShape && length)
            return {};
        // Numbers have nothing to clone in them: a hole is all there is to look for, and the rest is one copy.
        if (shape == Int32Shape && containsHole(array->butterfly()->contiguous().data(), length))
            return {};
        if (shape == DoubleShape && containsHole(array->butterfly()->contiguousDouble().data(), length))
            return {};

        Structure* cloneStructure = m_globalObject->arrayStructureForIndexingTypeDuringAllocation(IsArray | shape);
        if (hasAnyArrayStorage(cloneStructure->indexingType())) [[unlikely]]
            return {};
        JSArray* clone = JSArray::tryCreate(m_vm, cloneStructure, length);
        if (!clone) [[unlikely]]
            return {};
        remember(array, clone);

        if (shape == Int32Shape || shape == DoubleShape) {
            static_assert(sizeof(double) == sizeof(JSValue));
            memcpy(static_cast<void*>(clone->butterfly()->contiguous().data()), static_cast<const void*>(array->butterfly()->contiguous().data()), length * sizeof(JSValue));
            return clone;
        }

        for (unsigned i = 0; i < length; ++i) {
            JSValue value = array->butterfly()->contiguous().at(array, i).get();
            if (!value)
                return {};
            if (value.isCell()) {
                value = this->clone(value);
                if (!value)
                    return {};
            }
            clone->butterfly()->contiguous().at(clone, i).set(m_vm, clone, value);
        }
        return clone;
    }

    // An object that the tree holds twice, or that holds itself, is cloned once.
    JSObject* cloneOf(JSObject* object)
    {
        if (!m_indexes.isEmpty()) {
            auto it = m_indexes.find(object);
            return it == m_indexes.end() ? nullptr : asObject(m_clones.at(it->value));
        }
        for (unsigned i = 0; i < m_sources.size(); ++i) {
            if (m_sources[i] == object)
                return asObject(m_clones.at(i));
        }
        return nullptr;
    }

    void remember(JSObject* object, JSObject* clone)
    {
        unsigned index = m_sources.size();
        m_sources.append(object);
        m_clones.appendWithCrashOnOverflow(clone);
        if (!m_indexes.isEmpty())
            m_indexes.add(object, index);
        else if (m_sources.size() > linearSearchLimit) {
            for (unsigned i = 0; i < m_sources.size(); ++i)
                m_indexes.add(m_sources[i], i);
        }
    }

    static constexpr unsigned linearSearchLimit = 16;
    // The serializer has a limit of its own, and is what says whether a deeper tree is too deep.
    static constexpr unsigned maximumDepth = 512;

    VM& m_vm;
    JSGlobalObject* m_globalObject;
    unsigned m_depth { 0 };
    Vector<JSObject*, linearSearchLimit + 1> m_sources;
    MarkedArgumentBuffer m_clones;
    UncheckedKeyHashMap<JSObject*, unsigned> m_indexes;
};

JSC_DEFINE_HOST_FUNCTION(jsFunctionStructuredClone, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() == 0) {
        throwTypeError(globalObject, throwScope, "structuredClone requires 1 argument"_s);
        return {};
    }

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue options = callFrame->argument(1);

    // https://html.spec.whatwg.org/multipage/structured-data.html#dom-structuredclone
    // Convert the options dictionary (including its `transfer` sequence) per WebIDL
    // before serializing, so an invalid transfer list throws without detaching anything.
    auto serializeOptions = convertDictionary<StructuredSerializeOptions>(*globalObject, options);
    RETURN_IF_EXCEPTION(throwScope, {});

    if (value.isObject() && serializeOptions.transfer.isEmpty()) {
        PlainTreeCloner cloner(vm, globalObject);
        if (JSValue clone = cloner.clone(value))
            return JSValue::encode(clone);
    }

    Vector<RefPtr<MessagePort>> ports;
    // structuredClone never leaves this agent cluster, so SABs may share their backing store per
    // https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal —
    // only the WorkerPostMessage context takes the SAB-sharing path; Default would copy to a plain AB.
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(serializeOptions.transfer), ports,
        SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    RETURN_IF_EXCEPTION(throwScope, {});

    JSValue deserialized = serialized.releaseReturnValue()->deserialize(*globalObject, globalObject, ports);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(deserialized);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionStructuredCloneAdvanced, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 4) {
        throwTypeError(globalObject, throwScope, "structuredCloneAdvanced requires 3 arguments"_s);
        return {};
    }

    JSC::JSValue value = callFrame->argument(0);
    JSC::JSValue transferListValue = callFrame->argument(1);
    bool isForTransfer = callFrame->argument(2).toBoolean(globalObject);
    bool isForStorage = callFrame->argument(3).toBoolean(globalObject);
    JSC::JSValue serializationContextValue = callFrame->argument(4);

    SerializationContext serializationContext = SerializationContext::Default;
    if (serializationContextValue.isString()) {
        String serializationContextString = serializationContextValue.getString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (serializationContextString == "worker"_s) {
            serializationContext = SerializationContext::WorkerPostMessage;
        } else if (serializationContextString == "window"_s) {
            serializationContext = SerializationContext::WindowPostMessage;
        } else if (serializationContextString == "postMessage"_s) {
            serializationContext = SerializationContext::WindowPostMessage;
        } else if (serializationContextString == "default"_s) {
            serializationContext = SerializationContext::Default;
        } else {
            throwTypeError(globalObject, throwScope, "invalid serialization context"_s);
            return {};
        }
    }

    SerializationForCrossProcessTransfer forTransfer = isForTransfer ? SerializationForCrossProcessTransfer::Yes : SerializationForCrossProcessTransfer::No;
    SerializationForStorage forStorage = isForStorage ? SerializationForStorage::Yes : SerializationForStorage::No;

    Vector<JSC::Strong<JSC::JSObject>> transferList;

    if (transferListValue.isObject()) {
        JSC::JSObject* transferListObject = transferListValue.getObject();
        if (auto* transferListArray = dynamicDowncast<JSC::JSArray>(transferListObject)) {
            for (unsigned i = 0; i < transferListArray->length(); i++) {
                JSC::JSValue transferListValue = transferListArray->get(globalObject, i);
                RETURN_IF_EXCEPTION(throwScope, {});
                if (transferListValue.isObject()) {
                    transferList.append(JSC::Strong<JSC::JSObject>(vm, transferListValue.getObject()));
                }
            }
        }
    }

    Vector<RefPtr<MessagePort>> ports;
    ExceptionOr<Ref<SerializedScriptValue>> serialized = SerializedScriptValue::create(*globalObject, value, WTF::move(transferList), ports, forStorage, serializationContext, forTransfer);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (serialized.hasException()) {
        WebCore::propagateException(*globalObject, throwScope, serialized.releaseException());
        RELEASE_AND_RETURN(throwScope, {});
    }
    RETURN_IF_EXCEPTION(throwScope, {});

    JSValue deserialized = serialized.releaseReturnValue()->deserialize(*globalObject, globalObject, ports);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(deserialized);
}

} // namespace WebCore
