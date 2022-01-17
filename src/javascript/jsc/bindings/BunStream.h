#pragma once

#include "BunBuiltinNames.h"
#include "BunClientData.h"
#include "root.h"

namespace Bun {

using namespace JSC;

class Readable : public JSC::JSNonFinalObject {
  using Base = JSC::JSNonFinalObject;

    public:
  Readable(JSC::VM &vm, Bun__Readable *readable, JSC::Structure *structure) : Base(vm, structure) {
    readable_ = readable;
  }

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

  static Readable *create(JSC::VM &vm, Bun__readable *readable_, JSC::Structure *structure) {
    Readable *accessor =
      new (NotNull, JSC::allocateCell<Readable>(vm.heap)) Readable(vm, structure);
    accessor->finishCreation(vm);
    return accessor;
  }

  void finishCreation(JSC::VM &vm);

    private:
  Bun__Readable *readable_;
};

class Writable : public JSC::JSNonFinalObject {
  using Base = JSC::JSNonFinalObject;

    public:
  Writable(JSC::VM &vm, Bun__Writable *writable, JSC::Structure *structure) : Base(vm, structure) {
    writable_ = writable;
  }

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

  static Writable *create(JSC::VM &vm, Bun__Writable *writable_, JSC::Structure *structure) {
    Writable *accessor =
      new (NotNull, JSC::allocateCell<Writable>(vm.heap)) Writable(vm, structure);
    accessor->finishCreation(vm);
    return accessor;
  }

  void finishCreation(JSC::VM &vm);

    private:
  Bun__Writable *writable_;
};

} // namespace Bun