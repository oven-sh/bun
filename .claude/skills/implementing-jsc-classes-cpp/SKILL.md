---
name: implementing-jsc-classes-cpp
description: Implements JavaScript classes in C++ using JavaScriptCore. Use when creating new JS classes with C++ bindings, prototypes, or constructors.
---

# Implementing JavaScript Classes in C++

## Class Structure

For publicly accessible Constructor and Prototype, create 3 classes:

1. **`class Foo : public JSC::DestructibleObject`** - if C++ fields exist; otherwise use `JSC::constructEmptyObject` with `putDirectOffset`
2. **`class FooPrototype : public JSC::JSNonFinalObject`**
3. **`class FooConstructor : public JSC::InternalFunction`**

No public constructor? Only Prototype and class needed.

## Iso Subspaces

Classes with C++ fields need subspaces in:

- `src/jsc/bindings/webcore/DOMClientIsoSubspaces.h`
- `src/jsc/bindings/webcore/DOMIsoSubspaces.h`

```cpp
template<typename MyClassT, JSC::SubspaceAccess mode>
static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm) {
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<MyClassT, WebCore::UseCustomHeapCellType::No>(
        vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForMyClassT, m_subspaceForMyClassT));
}
```

`subspaceForImpl` only reads the slots inline. The subspaces themselves are created by `subspaceForImplSlow` in `src/jsc/bindings/BunClientData.cpp`, which is the only place that constructs an `IsoSubspace` (`test/internal/source-lints/iso-subspace-creation.test.ts` checks this).

## Property Definitions

```cpp
static JSC_DECLARE_HOST_FUNCTION(jsFooProtoFuncMethod);
static JSC_DECLARE_CUSTOM_GETTER(jsFooGetter_property);

static const HashTableValue JSFooPrototypeTableValues[] = {
    { "property"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsFooGetter_property, 0 } },
    { "method"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsFooProtoFuncMethod, 1 } },
};
```

## Prototype Class

```cpp
class JSFooPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSFooPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure) {
        JSFooPrototype* prototype = new (NotNull, Bun::allocatePlainObjectCell(vm, sizeof(JSFooPrototype))) JSFooPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype) {
        auto* structure = Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSFooPrototype(JSC::VM& vm, JSC::Structure* structure) : Base(vm, structure) {}
    void finishCreation(JSC::VM& vm);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSFooPrototype, JSFooPrototype::Base);

void JSFooPrototype::finishCreation(VM& vm) {
    Base::finishCreation(vm);
    Bun::reifyStaticPropertyTable(vm, JSFoo::info(), JSFooPrototypeTableValues, *this);
    Bun::putToStringTagWithoutTransition(vm, this, info());
}
```

A prototype class adds no C++ field and no destructor to `JSC::JSNonFinalObject`, so its object fits in the shared `vm.plainObjectSpace()`. `Bun::allocatePlainObjectCell` allocates there and never asks the class for a subspace, so the class has no `subspaceFor` member. `STATIC_ASSERT_ISO_SUBSPACE_SHARABLE` fails the build when the class gains a field or its own `destroy`. Keep the assert at file scope, after the class: the compiler does not evaluate it inside a member template that nothing instantiates.

`Bun::allocatePlainObjectCell`, `Bun::createClassStructure`, `Bun::reifyStaticPropertyTable` and `Bun::putToStringTagWithoutTransition` are declared in `src/jsc/bindings/BunClientData.h`. They are the out-of-line forms of `JSC::allocateCell`, `JSC::Structure::create`, `JSC::reifyStaticProperties` and `JSC_TO_STRING_TAG_WITHOUT_TRANSITION()`. Use them so that a new class does not inline its own copy of that once-per-class setup.

## Getter/Setter/Function Definitions

```cpp
// Getter
JSC_DEFINE_CUSTOM_GETTER(jsFooGetter_prop, (JSGlobalObject* globalObject, EncodedJSValue thisValue, PropertyName)) {
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSFoo* thisObject = jsDynamicCast<JSFoo*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "JSFoo"_s, "prop"_s);
        return {};
    }
    return JSValue::encode(jsBoolean(thisObject->value()));
}

// Function
JSC_DEFINE_HOST_FUNCTION(jsFooProtoFuncMethod, (JSGlobalObject* globalObject, CallFrame* callFrame)) {
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSFoo*>(callFrame->thisValue());
    if (UNLIKELY(!thisObject)) {
        Bun::throwThisTypeError(*globalObject, scope, "Foo"_s, "method"_s);
        return {};
    }
    return JSValue::encode(thisObject->doSomething(vm, globalObject));
}
```

## Constructor Class

```cpp
class JSFooConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSFooConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype) {
        JSFooConstructor* constructor = new (NotNull, JSC::allocateCell<JSFooConstructor>(vm)) JSFooConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm) { return &vm.internalFunctionSpace(); }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype) {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSFooConstructor(JSC::VM& vm, JSC::Structure* structure) : Base(vm, structure, callFoo, constructFoo) {}

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype) {
        Base::finishCreation(vm, 0, "Foo"_s);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    }
};
```

## Structure Caching

Add to `ZigGlobalObject.h`:

```cpp
JSC::LazyClassStructure m_JSFooClassStructure;
```

Initialize in `ZigGlobalObject.cpp`:

```cpp
m_JSFooClassStructure.initLater([](LazyClassStructure::Initializer& init) {
    Bun::initJSFooClassStructure(init);
});
```

Visit in `visitChildrenImpl`:

```cpp
m_JSFooClassStructure.visit(visitor);
```

## Expose to Zig

```cpp
extern "C" JSC::EncodedJSValue Bun__JSFooConstructor(Zig::GlobalObject* globalObject) {
    return JSValue::encode(globalObject->m_JSFooClassStructure.constructor(globalObject));
}

extern "C" EncodedJSValue Bun__Foo__toJS(Zig::GlobalObject* globalObject, Foo* foo) {
    auto* structure = globalObject->m_JSFooClassStructure.get(globalObject);
    return JSValue::encode(JSFoo::create(globalObject->vm(), structure, globalObject, WTFMove(foo)));
}
```

Include `#include "root.h"` at the top of C++ files.
