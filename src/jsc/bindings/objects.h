// #pragma once

// #include "root.h"
// #include "headers.h"

// #include <JavaScriptCore/JSObject.h>
//
// #include <JavaScriptCore/InternalFunction.h>

// namespace Zig {

// class ModulePrototype final : public JSC::JSNonFinalObject {
// public:
//     using Base = JSC::JSNonFinalObject;
//     DECLARE_EXPORT_INFO;
//     static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::ImplementsHasInstance | JSC::ImplementsDefaultHasInstance;
//     static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

//     template<typename CellType, JSC::SubspaceAccess>
//     static JSC::IsoSubspace* subspaceFor(JSC::VM& vm)
//     {
//         STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(Headers, Base);
//         return &vm.plainObjectSpace;
//     }

//     static ModulePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* zigBase)
//     {
//         ModulePrototype* object = new (NotNull, JSC::allocateCell<ModulePrototype>(vm.heap)) ModulePrototype(vm, structure);
//         !!zigBase ? object->finishCreation(vm, globalObject, zigBase) : object->finishCreation(vm, globalObject);
//         return object;
//     }

//     static JSC::JSObject* createPrototype(JSC::VM&, JSC::JSGlobalObject&);
//     static JSC::JSObject* prototype(JSC::VM&, JSC::JSGlobalObject&);

//     static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
//     {
//         return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
//     }

//     void* m_zigBase;

// private:
//     ModulePrototype(JSC::VM&, JSC::Structure*) : Base(vm, structure) {
//         m_zigBase = nullptr;
//     };
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*, void* zigBase);
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

// };

// class ModuleExportsMap final : public JSC::JSNonFinalObject {
// public:
//     using Base = JSC::JSNonFinalObject;
//     DECLARE_EXPORT_INFO;
//     static constexpr unsigned StructureFlags = Base::StructureFlags;
//     static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

//     template<typename CellType, JSC::SubspaceAccess>
//     static JSC::IsoSubspace* subspaceFor(JSC::VM& vm)
//     {
//         STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(Headers, Base);
//         return &vm.plainObjectSpace;
//     }

//     static ModulePrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* zigBase)
//     {
//         ModulePrototype* object = new (NotNull, JSC::allocateCell<ModulePrototype>(vm.heap)) ModulePrototype(vm, structure);
//         !!zigBase ? object->finishCreation(vm, globalObject, zigBase) : object->finishCreation(vm, globalObject);
//         return object;
//     }

//     static JSC::JSObject* createPrototype(JSC::VM&, JSC::JSGlobalObject&);
//     static JSC::JSObject* prototype(JSC::VM&, JSC::JSGlobalObject&);

//     static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
//     {
//         return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
//     }

//     void* m_zigBase;

// private:
//     ModulePrototype(JSC::VM&, JSC::Structure*) : Base(vm, structure) {
//         m_zigBase = nullptr;
//     };
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*, void* zigBase);
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

// };

// }

// namespace Zig {

// class HeadersPrototype final : public JSC::JSNonFinalObject {
// public:
//     using Base = JSC::JSNonFinalObject;
//     DECLARE_EXPORT_INFO;
//     static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::ImplementsHasInstance | JSC::ImplementsDefaultHasInstance;
//     static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

//     template<typename CellType, JSC::SubspaceAccess>
//     static JSC::IsoSubspace* subspaceFor(JSC::VM& vm)
//     {
//         STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(Headers, Base);
//         return &vm.plainObjectSpace;
//     }

//     static HeadersPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* zigBase)
//     {
//         HeadersPrototype* object = new (NotNull, JSC::allocateCell<HeadersPrototype>(vm.heap)) HeadersPrototype(vm, structure);
//         !!zigBase ? object->finishCreation(vm, globalObject, zigBase) : object->finishCreation(vm, globalObject);
//         return object;
//     }

//     static HeadersPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
//     {
//         HeadersPrototype* object = new (NotNull, JSC::allocateCell<HeadersPrototype>(vm.heap)) HeadersPrototype(vm, structure);
//         object->finishCreation(vm, globalObject);
//         return object;
//     }

//     JSC::JSValue get(JSC::JSGlobalObject&, JSC::JSValue);
//     bool put(JSC::JSGlobalObject&, JSC::JSValue, JSC::JSValue);
//     bool has(JSC::JSGlobalObject&, JSC::JSValue);
//     void remove(JSC::JSGlobalObject&, JSC::JSValue);
//     void clear(JSC::JSGlobalObject&, JSC::JSValue);

//     static JSC::JSObject* createPrototype(JSC::VM&, JSC::JSGlobalObject&);
//     static JSC::JSObject* prototype(JSC::VM&, JSC::JSGlobalObject&);

//     static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
//     {
//         return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
//     }

//     void* m_zigBase;

// private:
//     HeadersPrototype(JSC::VM&, JSC::Structure*) : Base(vm, structure) {
//         m_zigBase = nullptr;
//     };
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*, void* zigBase);
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

// };

// JSC_DECLARE_HOST_FUNCTION(headersFuncPrototypeGet);
// JSC_DECLARE_HOST_FUNCTION(headersFuncPrototypePut);
// JSC_DECLARE_HOST_FUNCTION(headersFuncPrototypeHas);
// JSC_DECLARE_HOST_FUNCTION(headersFuncPrototypeRemove);
// JSC_DECLARE_HOST_FUNCTION(headersFuncPrototypeClear);

// class HeadersConstructor final : public JSC::InternalFunction {
// public:
//     typedef InternalFunction Base;

//     static HeadersConstructor* create(JSC::VM& vm, JSC::Structure* structure, HeadersPrototype* mapPrototype)
//     {
//         HeadersConstructor* constructor = new (NotNull, JSC::allocateCell<HeadersConstructor>(vm.heap)) HeadersConstructor(vm, structure);
//         constructor->finishCreation(vm, mapPrototype);
//         return constructor;
//     }

//     DECLARE_EXPORT_INFO;

//     static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
//     {
//         return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
//     }

// private:
//     HeadersConstructor(JSC::VM&, JSC::Structure*);

//     void finishCreation(JSC::VM&, HeadersPrototype*);
// };

// JSC_DECLARE_HOST_FUNCTION(headersFuncConstructor);

// class RequestConstructor final : public JSC::InternalFunction {
// public:
//     typedef InternalFunction Base;

//     static RequestConstructor* create(JSC::VM& vm, JSC::Structure* structure, RequestPrototype* mapPrototype)
//     {
//         RequestConstructor* constructor = new (NotNull, JSC::allocateCell<RequestConstructor>(vm.heap)) RequestConstructor(vm, structure);
//         constructor->finishCreation(vm, mapPrototype);
//         return constructor;
//     }

//     DECLARE_EXPORT_INFO;

//     static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
//     {
//         return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
//     }

// private:
//     RequestConstructor(JSC::VM&, JSC::Structure*);

//     void finishCreation(JSC::VM&, RequestPrototype*);
// };

// JSC_DECLARE_HOST_FUNCTION(requestFuncConstructor);

// class RequestPrototype final : public JSC::JSNonFinalObject {
// public:
//     using Base = JSC::JSNonFinalObject;
//     DECLARE_EXPORT_INFO;
//     static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::ImplementsHasInstance | JSC::ImplementsDefaultHasInstance;
//     static constexpr JSC::DestructionMode needsDestruction = NeedsDestruction;

//     template<typename CellType, JSC::SubspaceAccess>
//     static JSC::IsoSubspace* subspaceFor(JSC::VM& vm)
//     {
//         STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(Headers, Base);
//         return &vm.plainObjectSpace;
//     }

//     static RequestPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, void* zigBase)
//     {
//         RequestPrototype* object = new (NotNull, JSC::allocateCell<RequestPrototype>(vm.heap)) RequestPrototype(vm, structure);
//         !!zigBase ? object->finishCreation(vm, globalObject, zigBase) : object->finishCreation(vm, globalObject);
//         return object;
//     }

//     static RequestPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
//     {
//         RequestPrototype* object = new (NotNull, JSC::allocateCell<RequestPrototype>(vm.heap)) RequestPrototype(vm, structure);
//         object->finishCreation(vm, globalObject);
//         return object;
//     }

//     static JSC::JSObject* createPrototype(JSC::VM&, JSC::JSGlobalObject&);
//     static JSC::JSObject* prototype(JSC::VM&, JSC::JSGlobalObject&);

//     static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
//     {
//         return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
//     }

//     void* m_zigBase;

// private:
//     RequestPrototype(JSC::VM&, JSC::Structure*) : Base(vm, structure) {
//         m_zigBase = nullptr;
//     };
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*, void* zigBase);
//     void finishCreation(JSC::VM&, JSC::JSGlobalObject*);

// };

// }
