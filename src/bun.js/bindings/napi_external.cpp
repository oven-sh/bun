

// #pragma once

// #include "root.h"

// #include "BunBuiltinNames.h"
// #include "BunClientData.h"

// namespace Zig {

// using namespace JSC;

// class NapiExternal : public JSC::JSNonFinalObject {
//     using Base = JSC::JSNonFinalObject;

// public:
//     NapiExternal(JSC::VM& vm, JSC::Structure* structure)
//         : Base(vm, structure)
//     {
//     }

//     DECLARE_INFO;

//     static constexpr unsigned StructureFlags = Base::StructureFlags;

//     template<typename CellType, SubspaceAccess> static GCClient::IsoSubspace* subspaceFor(VM& vm)
//     {
//         return &vm.plainObjectSpace();
//     }

//     static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
//         JSC::JSValue prototype)
//     {
//         return JSC::Structure::create(vm, globalObject, prototype,
//             JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
//     }

//     static NapiExternal* create(JSC::VM& vm, JSC::Structure* structure)
//     {
//         NapiExternal* accessor = new (NotNull, JSC::allocateCell<NapiExternal>(vm)) NapiExternal(vm, structure);
//         accessor->finishCreation(vm);
//         return accessor;
//     }

//     void finishCreation(JSC::VM& vm);
//     void* m_value;
// };

// } // namespace Zig