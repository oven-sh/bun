#pragma once

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "root.h"

namespace Zig {

class Process : public JSC::JSNonFinalObject {
  using Base = JSC::JSNonFinalObject;

    public:
  Process(JSC::VM &vm, JSC::Structure *structure) : Base(vm, structure) {}

  DECLARE_INFO;

  static constexpr unsigned StructureFlags = Base::StructureFlags;

  template <typename CellType, JSC::SubspaceAccess>
  static JSC::CompleteSubspace *subspaceFor(JSC::VM &vm) {
    return &vm.cellSpace;
  }

  static JSC::Structure *createStructure(JSC::VM &vm, JSC::JSGlobalObject *globalObject,
                                         JSC::JSValue prototype) {
    return JSC::Structure::create(vm, globalObject, prototype,
                                  JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
  }

  static Process *create(JSC::VM &vm, JSC::Structure *structure) {
    Process *accessor = new (NotNull, JSC::allocateCell<Process>(vm.heap)) Process(vm, structure);
    accessor->finishCreation(vm);
    return accessor;
  }

  void finishCreation(JSC::VM &vm);
};

} // namespace Zig