JSC::Structure* JSRequestStructure() { return m_JSRequest.getInitializedOnMainThread(this); }
        JSC::JSObject* JSRequestConstructor() { return m_JSRequest.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSRequestPrototype() { return m_JSRequest.prototypeInitializedOnMainThread(this); }
        JSC::LazyClassStructure m_JSRequest;
JSC::Structure* JSResponseStructure() { return m_JSResponse.getInitializedOnMainThread(this); }
        JSC::JSObject* JSResponseConstructor() { return m_JSResponse.constructorInitializedOnMainThread(this); }
        JSC::JSValue JSResponsePrototype() { return m_JSResponse.prototypeInitializedOnMainThread(this); }
        JSC::LazyClassStructure m_JSResponse;