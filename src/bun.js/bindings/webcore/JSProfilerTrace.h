#pragma once

#include "JSDOMBinding.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertDictionary.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "Profiler.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSObject.h>
#include <wtf/GetPtr.h>

namespace WebCore {

using namespace JSC;

// Forward declare all the convertDictionaryToJS functions needed by JSDOMConvertDictionary.h
JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject&, JSDOMGlobalObject&, const ProfilerInitOptions&);
JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject&, JSDOMGlobalObject&, const ProfilerSample&);
JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject&, JSDOMGlobalObject&, const ProfilerFrame&);
JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject&, JSDOMGlobalObject&, const ProfilerStack&);
JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject&, JSDOMGlobalObject&, const ProfilerTrace&);

// ProfilerInitOptions
template<> inline ProfilerInitOptions convertDictionary<ProfilerInitOptions>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool isNullOrUndefined = value.isUndefinedOrNull();
    auto* object = isNullOrUndefined ? nullptr : value.getObject();
    if (!isNullOrUndefined && !object) {
        throwTypeError(&lexicalGlobalObject, throwScope);
        return { };
    }

    ProfilerInitOptions result;

    JSValue sampleIntervalValue;
    if (isNullOrUndefined)
        sampleIntervalValue = JSC::jsUndefined();
    else {
        sampleIntervalValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "sampleInterval"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!sampleIntervalValue.isUndefined()) {
        result.sampleInterval = Converter<IDLDouble>::convert(lexicalGlobalObject, sampleIntervalValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "sampleInterval", "ProfilerInitOptions", "double");
        return { };
    }

    JSValue maxBufferSizeValue;
    if (isNullOrUndefined)
        maxBufferSizeValue = JSC::jsUndefined();
    else {
        maxBufferSizeValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "maxBufferSize"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!maxBufferSizeValue.isUndefined()) {
        result.maxBufferSize = Converter<IDLUnsignedLong>::convert(lexicalGlobalObject, maxBufferSizeValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "maxBufferSize", "ProfilerInitOptions", "unsigned long");
        return { };
    }

    return result;
}

inline JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject&, const ProfilerInitOptions& value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto* object = constructEmptyObject(&lexicalGlobalObject);

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "sampleInterval"_s)), JSC::jsNumber(value.sampleInterval));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "maxBufferSize"_s)), JSC::jsNumber(value.maxBufferSize));

    return object;
}

// ProfilerSample
template<> inline ProfilerSample convertDictionary<ProfilerSample>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool isNullOrUndefined = value.isUndefinedOrNull();
    auto* object = isNullOrUndefined ? nullptr : value.getObject();
    if (!isNullOrUndefined && !object) {
        throwTypeError(&lexicalGlobalObject, throwScope);
        return { };
    }

    ProfilerSample result;

    JSValue timestampValue;
    if (isNullOrUndefined)
        timestampValue = JSC::jsUndefined();
    else {
        timestampValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "timestamp"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!timestampValue.isUndefined()) {
        result.timestamp = Converter<IDLDouble>::convert(lexicalGlobalObject, timestampValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "timestamp", "ProfilerSample", "double");
        return { };
    }

    JSValue stackIdValue;
    if (isNullOrUndefined)
        stackIdValue = JSC::jsUndefined();
    else {
        stackIdValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "stackId"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!stackIdValue.isUndefined()) {
        result.stackId = Converter<IDLUnsignedLongLong>::convert(lexicalGlobalObject, stackIdValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    }

    return result;
}

inline JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const ProfilerSample& value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto* object = constructEmptyObject(&lexicalGlobalObject);

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "timestamp"_s)), toJS<IDLDouble>(lexicalGlobalObject, globalObject, value.timestamp));
    if (value.stackId.has_value())
        object->putDirect(vm, PropertyName(Identifier::fromString(vm, "stackId"_s)), toJS<IDLUnsignedLongLong>(lexicalGlobalObject, globalObject, value.stackId.value()));

    return object;
}

// ProfilerFrame
template<> inline ProfilerFrame convertDictionary<ProfilerFrame>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool isNullOrUndefined = value.isUndefinedOrNull();
    auto* object = isNullOrUndefined ? nullptr : value.getObject();
    if (!isNullOrUndefined && !object) {
        throwTypeError(&lexicalGlobalObject, throwScope);
        return { };
    }

    ProfilerFrame result;

    JSValue nameValue;
    if (isNullOrUndefined)
        nameValue = JSC::jsUndefined();
    else {
        nameValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "name"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!nameValue.isUndefined()) {
        result.name = Converter<IDLDOMString>::convert(lexicalGlobalObject, nameValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "name", "ProfilerFrame", "DOMString");
        return { };
    }

    JSValue resourceIdValue;
    if (!isNullOrUndefined) {
        resourceIdValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "resourceId"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
        if (!resourceIdValue.isUndefined()) {
            result.resourceId = Converter<IDLUnsignedLongLong>::convert(lexicalGlobalObject, resourceIdValue);
            RETURN_IF_EXCEPTION(throwScope, { });
        }
    }

    JSValue lineValue;
    if (!isNullOrUndefined) {
        lineValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "line"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
        if (!lineValue.isUndefined()) {
            result.line = Converter<IDLUnsignedLongLong>::convert(lexicalGlobalObject, lineValue);
            RETURN_IF_EXCEPTION(throwScope, { });
        }
    }

    JSValue columnValue;
    if (!isNullOrUndefined) {
        columnValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "column"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
        if (!columnValue.isUndefined()) {
            result.column = Converter<IDLUnsignedLongLong>::convert(lexicalGlobalObject, columnValue);
            RETURN_IF_EXCEPTION(throwScope, { });
        }
    }

    return result;
}

inline JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const ProfilerFrame& value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto* object = constructEmptyObject(&lexicalGlobalObject);

    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "name"_s)), toJS<IDLDOMString>(lexicalGlobalObject, globalObject, value.name));
    if (value.resourceId.has_value())
        object->putDirect(vm, PropertyName(Identifier::fromString(vm, "resourceId"_s)), toJS<IDLUnsignedLongLong>(lexicalGlobalObject, globalObject, value.resourceId.value()));
    if (value.line.has_value())
        object->putDirect(vm, PropertyName(Identifier::fromString(vm, "line"_s)), toJS<IDLUnsignedLongLong>(lexicalGlobalObject, globalObject, value.line.value()));
    if (value.column.has_value())
        object->putDirect(vm, PropertyName(Identifier::fromString(vm, "column"_s)), toJS<IDLUnsignedLongLong>(lexicalGlobalObject, globalObject, value.column.value()));

    return object;
}

// ProfilerStack
template<> inline ProfilerStack convertDictionary<ProfilerStack>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool isNullOrUndefined = value.isUndefinedOrNull();
    auto* object = isNullOrUndefined ? nullptr : value.getObject();
    if (!isNullOrUndefined && !object) {
        throwTypeError(&lexicalGlobalObject, throwScope);
        return { };
    }

    ProfilerStack result;

    JSValue parentIdValue;
    if (!isNullOrUndefined) {
        parentIdValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "parentId"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
        if (!parentIdValue.isUndefined()) {
            result.parentId = Converter<IDLUnsignedLongLong>::convert(lexicalGlobalObject, parentIdValue);
            RETURN_IF_EXCEPTION(throwScope, { });
        }
    }

    JSValue frameIdValue;
    if (isNullOrUndefined)
        frameIdValue = JSC::jsUndefined();
    else {
        frameIdValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "frameId"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!frameIdValue.isUndefined()) {
        result.frameId = Converter<IDLUnsignedLongLong>::convert(lexicalGlobalObject, frameIdValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "frameId", "ProfilerStack", "unsigned long long");
        return { };
    }

    return result;
}

inline JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const ProfilerStack& value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto* object = constructEmptyObject(&lexicalGlobalObject);

    if (value.parentId.has_value())
        object->putDirect(vm, PropertyName(Identifier::fromString(vm, "parentId"_s)), toJS<IDLUnsignedLongLong>(lexicalGlobalObject, globalObject, value.parentId.value()));
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "frameId"_s)), toJS<IDLUnsignedLongLong>(lexicalGlobalObject, globalObject, value.frameId));

    return object;
}

// ProfilerTrace
template<> inline ProfilerTrace convertDictionary<ProfilerTrace>(JSC::JSGlobalObject& lexicalGlobalObject, JSC::JSValue value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    bool isNullOrUndefined = value.isUndefinedOrNull();
    auto* object = isNullOrUndefined ? nullptr : value.getObject();
    if (!isNullOrUndefined && !object) {
        throwTypeError(&lexicalGlobalObject, throwScope);
        return { };
    }

    ProfilerTrace result;

    JSValue resourcesValue;
    if (isNullOrUndefined)
        resourcesValue = JSC::jsUndefined();
    else {
        resourcesValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "resources"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!resourcesValue.isUndefined()) {
        result.resources = Converter<IDLSequence<IDLDOMString>>::convert(lexicalGlobalObject, resourcesValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "resources", "ProfilerTrace", "sequence");
        return { };
    }

    JSValue framesValue;
    if (isNullOrUndefined)
        framesValue = JSC::jsUndefined();
    else {
        framesValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "frames"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!framesValue.isUndefined()) {
        result.frames = Converter<IDLSequence<IDLDictionary<ProfilerFrame>>>::convert(lexicalGlobalObject, framesValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "frames", "ProfilerTrace", "sequence");
        return { };
    }

    JSValue stacksValue;
    if (isNullOrUndefined)
        stacksValue = JSC::jsUndefined();
    else {
        stacksValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "stacks"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!stacksValue.isUndefined()) {
        result.stacks = Converter<IDLSequence<IDLDictionary<ProfilerStack>>>::convert(lexicalGlobalObject, stacksValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "stacks", "ProfilerTrace", "sequence");
        return { };
    }

    JSValue samplesValue;
    if (isNullOrUndefined)
        samplesValue = JSC::jsUndefined();
    else {
        samplesValue = object->get(&lexicalGlobalObject, PropertyName(Identifier::fromString(vm, "samples"_s)));
        RETURN_IF_EXCEPTION(throwScope, { });
    }
    if (!samplesValue.isUndefined()) {
        result.samples = Converter<IDLSequence<IDLDictionary<ProfilerSample>>>::convert(lexicalGlobalObject, samplesValue);
        RETURN_IF_EXCEPTION(throwScope, { });
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "samples", "ProfilerTrace", "sequence");
        return { };
    }

    return result;
}

inline JSC::JSValue convertDictionaryToJS(JSC::JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const ProfilerTrace& value)
{
    VM& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* object = constructEmptyObject(&lexicalGlobalObject);

    auto resourcesArray = toJS<IDLSequence<IDLDOMString>>(lexicalGlobalObject, globalObject, throwScope, value.resources);
    RETURN_IF_EXCEPTION(throwScope, { });
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "resources"_s)), resourcesArray);

    auto framesArray = toJS<IDLSequence<IDLDictionary<ProfilerFrame>>>(lexicalGlobalObject, globalObject, throwScope, value.frames);
    RETURN_IF_EXCEPTION(throwScope, { });
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "frames"_s)), framesArray);

    auto stacksArray = toJS<IDLSequence<IDLDictionary<ProfilerStack>>>(lexicalGlobalObject, globalObject, throwScope, value.stacks);
    RETURN_IF_EXCEPTION(throwScope, { });
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "stacks"_s)), stacksArray);

    auto samplesArray = toJS<IDLSequence<IDLDictionary<ProfilerSample>>>(lexicalGlobalObject, globalObject, throwScope, value.samples);
    RETURN_IF_EXCEPTION(throwScope, { });
    object->putDirect(vm, PropertyName(Identifier::fromString(vm, "samples"_s)), samplesArray);

    return object;
}

} // namespace WebCore