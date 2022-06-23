// GENERATED FILE
#pragma once

namespace Zig {

  template<typename Visitor>
  void LazyStaticFunctions::visit(Visitor& visitor) {
       this->m_Bun__HTTPRequestContext__reject.visit(visitor);
  this->m_Bun__HTTPRequestContext__resolve.visit(visitor);
  this->m_Bun__HTTPRequestContextTLS__reject.visit(visitor);
  this->m_Bun__HTTPRequestContextTLS__resolve.visit(visitor);
  this->m_Bun__HTTPRequestContextDebug__reject.visit(visitor);
  this->m_Bun__HTTPRequestContextDebug__resolve.visit(visitor);
  this->m_Bun__HTTPRequestContextDebugTLS__reject.visit(visitor);
  this->m_Bun__HTTPRequestContextDebugTLS__resolve.visit(visitor);

  }
  
  void LazyStaticFunctions::init(Zig::GlobalObject *globalObject) {
    
  m_Bun__HTTPRequestContext__reject.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("reject"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContext__reject,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContext__reject
          );
          init.set(function);
      });

  m_Bun__HTTPRequestContext__resolve.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("resolve"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContext__resolve,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContext__resolve
          );
          init.set(function);
      });

  m_Bun__HTTPRequestContextTLS__reject.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("reject"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContextTLS__reject,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContextTLS__reject
          );
          init.set(function);
      });

  m_Bun__HTTPRequestContextTLS__resolve.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("resolve"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContextTLS__resolve,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContextTLS__resolve
          );
          init.set(function);
      });

  m_Bun__HTTPRequestContextDebug__reject.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("reject"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContextDebug__reject,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContextDebug__reject
          );
          init.set(function);
      });

  m_Bun__HTTPRequestContextDebug__resolve.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("resolve"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContextDebug__resolve,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContextDebug__resolve
          );
          init.set(function);
      });

  m_Bun__HTTPRequestContextDebugTLS__reject.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("reject"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContextDebugTLS__reject,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContextDebugTLS__reject
          );
          init.set(function);
      });

  m_Bun__HTTPRequestContextDebugTLS__resolve.initLater(
      [](const JSC::LazyProperty<Zig::GlobalObject, Zig::JSFFIFunction>::Initializer& init) {
          WTF::String functionName = WTF::String("resolve"_s);
          Zig::JSFFIFunction* function = Zig::JSFFIFunction::create(
               init.vm,
               init.owner, 
               1,
               functionName,
               Bun__HTTPRequestContextDebugTLS__resolve,
               JSC::NoIntrinsic,
               Bun__HTTPRequestContextDebugTLS__resolve
          );
          init.set(function);
      });

  }

} // namespace Zig
