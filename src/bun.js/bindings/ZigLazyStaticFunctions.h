// GENERATED FILE
#pragma once
#include "root.h"

namespace Zig {
  class GlobalObject;
  class JSFFIFunction;
 
  class LazyStaticFunctions {
    public:

    void init(Zig::GlobalObject* globalObject);

    template<typename Visitor>
    void visit(Visitor& visitor);
    
  
  /* -- BEGIN FUNCTION DEFINITIONS -- */
  
#pragma mark HTTPRequestContext

  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContext__reject;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContext__reject(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContext__reject.getInitializedOnMainThread(globalObject); }
  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContext__resolve;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContext__resolve(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContext__resolve.getInitializedOnMainThread(globalObject); }

#pragma mark HTTPRequestContextTLS

  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContextTLS__reject;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContextTLS__reject(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContextTLS__reject.getInitializedOnMainThread(globalObject); }
  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContextTLS__resolve;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContextTLS__resolve(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContextTLS__resolve.getInitializedOnMainThread(globalObject); }

#pragma mark HTTPRequestContextDebug

  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContextDebug__reject;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContextDebug__reject(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContextDebug__reject.getInitializedOnMainThread(globalObject); }
  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContextDebug__resolve;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContextDebug__resolve(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContextDebug__resolve.getInitializedOnMainThread(globalObject); }

#pragma mark HTTPRequestContextDebugTLS

  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContextDebugTLS__reject;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContextDebugTLS__reject(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContextDebugTLS__reject.getInitializedOnMainThread(globalObject); }
  JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction> m_Bun__HTTPRequestContextDebugTLS__resolve;
  Zig::JSFFIFunction* get__Bun__HTTPRequestContextDebugTLS__resolve(Zig::GlobalObject *globalObject) { return m_Bun__HTTPRequestContextDebugTLS__resolve.getInitializedOnMainThread(globalObject); }

  /* -- END FUNCTION DEFINITIONS-- */
  };

} // namespace Zig
