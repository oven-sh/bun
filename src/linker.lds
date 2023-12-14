BUN_1.0 {
    global:
	napi*;
	node_api_*;
	__cxa_atexit;
	__cxa_thread_atexit_impl;
	__ZN2v87Isolate10GetCurrentEv;
	__ZN2v87Isolate13TryGetCurrentEv;
	__ZN2v87Isolate17GetCurrentContextEv;
	__ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_;
	__ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_;
    local:
	*;
};
