#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSCast.h>
#include "ZigGlobalObject.h"

namespace WebCore {

Zig::GlobalObject* toJSDOMGlobalObject(ScriptExecutionContext& ctx, DOMWrapperWorld& world)
{
    return JSC::jsCast<Zig::GlobalObject*>(ctx.jsGlobalObject());
}

// static JSDOMGlobalObject& callerGlobalObject(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame* callFrame, bool skipFirstFrame, bool lookUpFromVMEntryScope)
// {
//     VM& vm = lexicalGlobalObject.vm();
//     if (callFrame) {
//         class GetCallerGlobalObjectFunctor {
//         public:
//             GetCallerGlobalObjectFunctor(bool skipFirstFrame)
//                 : m_skipFirstFrame(skipFirstFrame)
//             {
//             }

//             StackVisitor::Status operator()(StackVisitor& visitor) const
//             {
//                 if (m_skipFirstFrame) {
//                     if (!m_hasSkippedFirstFrame) {
//                         m_hasSkippedFirstFrame = true;
//                         return StackVisitor::Continue;
//                     }
//                 }

//                 if (auto* codeBlock = visitor->codeBlock())
//                     m_globalObject = codeBlock->globalObject();
//                 else {
//                     ASSERT(visitor->callee().rawPtr());
//                     // FIXME: Callee is not an object if the caller is Web Assembly.
//                     // Figure out what to do here. We can probably get the global object
//                     // from the top-most Wasm Instance. https://bugs.webkit.org/show_bug.cgi?id=165721
//                     if (visitor->callee().isCell() && visitor->callee().asCell()->isObject())
//                         m_globalObject = jsCast<JSObject*>(visitor->callee().asCell())->globalObject();
//                 }
//                 return StackVisitor::Done;
//             }

//             JSC::JSGlobalObject* globalObject() const { return m_globalObject; }

//         private:
//             bool m_skipFirstFrame { false };
//             mutable bool m_hasSkippedFirstFrame { false };
//             mutable JSC::JSGlobalObject* m_globalObject { nullptr };
//         };

//         GetCallerGlobalObjectFunctor iter(skipFirstFrame);
//         callFrame->iterate(vm, iter);
//         if (iter.globalObject())
//             return *jsCast<JSDOMGlobalObject*>(iter.globalObject());
//     }

//     // In the case of legacyActiveGlobalObjectForAccessor, it is possible that vm.topCallFrame is nullptr when the script is evaluated as JSONP.
//     // Since we put JSGlobalObject to VMEntryScope, we can retrieve the right globalObject from that.
//     // For callerGlobalObject, we do not check vm.entryScope to keep it the old behavior.
//     if (lookUpFromVMEntryScope) {
//         if (vm.entryScope) {
//             if (auto* result = vm.entryScope->globalObject())
//                 return *jsCast<JSDOMGlobalObject*>(result);
//         }
//     }

//     // If we cannot find JSGlobalObject in caller frames, we just return the current lexicalGlobalObject.
//     return *jsCast<JSDOMGlobalObject*>(&lexicalGlobalObject);
// }

// JSDOMGlobalObject& callerGlobalObject(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame* callFrame)
// {
//     constexpr bool skipFirstFrame = true;
//     constexpr bool lookUpFromVMEntryScope = false;
//     return callerGlobalObject(lexicalGlobalObject, callFrame, skipFirstFrame, lookUpFromVMEntryScope);
// }

// JSDOMGlobalObject& legacyActiveGlobalObjectForAccessor(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame* callFrame)
// {
//     constexpr bool skipFirstFrame = false;
//     constexpr bool lookUpFromVMEntryScope = true;
//     return callerGlobalObject(lexicalGlobalObject, callFrame, skipFirstFrame, lookUpFromVMEntryScope);
// }

}
