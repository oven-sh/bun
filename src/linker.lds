BUN_1.1 {
    global:
	napi*;
	node_api_*;
	node_module_register;
	_ZN2v8*;

	uv_os_getpid;
	uv_os_getppid;

	extern "C++" {
		v8::*;
		node::*;
	};
    local:
	*;
};
