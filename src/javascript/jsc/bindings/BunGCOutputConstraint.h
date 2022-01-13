
// #pragma once

// #include "root.h"
// #include <JavaScriptCore/MarkingConstraint.h>

// namespace JSC {
// class VM;
// }

// namespace Bun {

// class JSVMClientData;

// class BunGCOutputConstraint : public JSC::MarkingConstraint {
//   WTF_MAKE_FAST_ALLOCATED;

//     public:
//   BunGCOutputConstraint(JSC::VM &, Bun::JSVMClientData &);
//   ~BunGCOutputConstraint(){};

//     protected:
//   void executeImpl(JSC::AbstractSlotVisitor &) override;
//   void executeImpl(JSC::SlotVisitor &) override;

//     private:
//   template <typename Visitor> void executeImplImpl(Visitor &);

//   JSC::VM &m_vm;
//   JSVMClientData &m_clientData;
//   uint64_t m_lastExecutionVersion;
// };

// } // namespace Bun
