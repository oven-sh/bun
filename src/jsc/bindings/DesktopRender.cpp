// The plain objects of src/dom/api/render.
#include "root.h"

#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/StructureCache.h>

using namespace JSC;

static PropertyName nameOf(StringImpl* atom) { return static_cast<UniquedStringImpl*>(static_cast<AtomStringImpl*>(atom)); }

extern "C" EncodedJSValue Bun__Render__get(JSGlobalObject* globalObject, EncodedJSValue value, StringImpl* name)
{
    return JSValue::encode(JSValue::decode(value).get(globalObject, nameOf(name)));
}

extern "C" bool Bun__Render__has(JSGlobalObject* globalObject, JSObject* object, StringImpl* name)
{
    return object->hasProperty(globalObject, nameOf(name));
}

extern "C" void Bun__Render__set(JSGlobalObject* globalObject, JSObject* object, StringImpl* name, EncodedJSValue value)
{
    PutPropertySlot slot(object, true);
    object->putInline(globalObject, nameOf(name), JSValue::decode(value), slot);
}

extern "C" EncodedJSValue Bun__Render__construct(JSGlobalObject* globalObject, EncodedJSValue constructor, EncodedJSValue argument)
{
    return JSValue::encode(construct(globalObject, JSValue::decode(constructor), ArgList { &argument, 1 }, "It is not a constructor"_s));
}

extern "C" void Bun__Render__makeFunction(JSGlobalObject* globalObject, JSObject* callable)
{
    callable->setPrototypeDirect(globalObject->vm(), globalObject->functionPrototype());
}

static constexpr unsigned renderElementSize = 4;

extern "C" Structure* Bun__Render__createElementStructure(JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), renderElementSize);
    PropertyOffset offset;
    for (auto name : { "$$typeof"_s, "type"_s, "key"_s, "props"_s })
        structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, name), 0, offset);
    return structure;
}

extern "C" JSObject* Bun__Render__createElement(JSGlobalObject* globalObject, Structure* structure, const EncodedJSValue* members)
{
    auto* element = constructEmptyObject(globalObject->vm(), structure);
    for (unsigned i = 0; i < renderElementSize; i++)
        element->putDirectOffset(globalObject->vm(), i, JSValue::decode(members[i]));
    return element;
}

extern "C" bool Bun__Render__readElement(JSObject* element, Structure* structure, EncodedJSValue* members)
{
    if (element->structure() != structure)
        return false;
    for (unsigned i = 0; i < renderElementSize; i++)
        members[i] = JSValue::encode(element->getDirect(i));
    return true;
}

static bool isPlain(JSObject* object)
{
    return object->type() == FinalObjectType && object->structure()->canPerformFastPropertyEnumeration() && !hasIndexedProperties(object->indexingType());
}

template<typename Visit> static void forEachProp(JSGlobalObject* globalObject, JSObject* object, const Visit& visit)
{
    auto& vm = globalObject->vm();
    if (isPlain(object)) {
        object->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) {
            if (!(entry.attributes() & PropertyAttribute::DontEnum) && !entry.key()->isSymbol())
                visit(entry.key(), object->getDirect(entry.offset()), entry.offset());
            return true;
        });
        return;
    }
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );
    for (const auto& name : names) {
        auto value = object->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, );
        visit(name.impl(), value, invalidOffset);
    }
}

struct Props {
    Vector<Identifier, 8> names;
    MarkedArgumentBuffer values;
};

static void collect(JSGlobalObject* globalObject, JSObject* object, Props& props)
{
    forEachProp(globalObject, object, [&](UniquedStringImpl* name, JSValue value, PropertyOffset) {
        props.names.append(Identifier::fromUid(globalObject->vm(), name));
        props.values.append(value);
    });
}

// `{ ...first, ...second }` without `except`, and without symbols.
extern "C" JSObject* Bun__Render__spread(JSGlobalObject* globalObject, EncodedJSValue first, EncodedJSValue second, StringImpl* except)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Props props;
    for (auto source : { first, second }) {
        if (auto* object = JSValue::decode(source).getObject())
            collect(globalObject, object, props);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    auto* result = constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min<size_t>(props.names.size() + 1, JSFinalObject::maxInlineCapacity));
    for (size_t i = 0; i < props.names.size(); i++) {
        if (props.names[i].impl() != except)
            result->putDirectMayBeIndex(globalObject, props.names[i], props.values.at(i));
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return result;
}

using VisitChange = bool (*)(void*, StringImpl* name, EncodedJSValue now, EncodedJSValue before);

// Whether there is any. What is gone comes first. `before` may be null, and `visit` returns false if it has thrown.
extern "C" bool Bun__Render__forEachChange(JSGlobalObject* globalObject, JSObject* before, JSObject* now, void* context, VisitChange visit)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Props candidates;
    auto note = [&](UniquedStringImpl* name, JSValue value, JSValue old) {
        if (value == old)
            return;
        candidates.names.append(Identifier::fromUid(vm, name));
        candidates.values.append(value);
        candidates.values.append(old);
    };
    if (before && before->structure() == now->structure() && isPlain(now))
        forEachProp(globalObject, now, [&](UniquedStringImpl* name, JSValue value, PropertyOffset offset) { note(name, value, before->getDirect(offset)); });
    else {
        Props old, fresh;
        if (before)
            collect(globalObject, before, old);
        RETURN_IF_EXCEPTION(scope, false);
        collect(globalObject, now, fresh);
        RETURN_IF_EXCEPTION(scope, false);
        for (size_t i = 0; i < old.names.size(); i++) {
            if (!fresh.names.contains(old.names[i]))
                note(old.names[i].impl(), JSValue(), old.values.at(i));
        }
        for (size_t i = 0; i < fresh.names.size(); i++) {
            auto known = old.names.find(fresh.names[i]);
            note(fresh.names[i].impl(), fresh.values.at(i), known == notFound ? jsUndefined() : old.values.at(known));
        }
    }
    bool hasChanged = false;
    for (size_t i = 0; i < candidates.names.size(); i++) {
        auto value = candidates.values.at(2 * i), old = candidates.values.at(2 * i + 1);
        bool isSame = value && sameValue(globalObject, value, old);
        RETURN_IF_EXCEPTION(scope, false);
        if (isSame)
            continue;
        hasChanged = true;
        if (!visit || !visit(context, candidates.names[i].impl(), JSValue::encode(value ?: jsUndefined()), JSValue::encode(old)))
            break;
    }
    scope.release();
    return hasChanged;
}
