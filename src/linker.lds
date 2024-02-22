BUN_1.0 {
    global:
	napi*;
	node_api_*;
	__cxa_atexit;
	__cxa_thread_atexit_impl;
	extern "C++" {
		v8::*;
		node::*;
	};
    local:
	*;
};
