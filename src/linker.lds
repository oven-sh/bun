BUN_1.1 {
    global:
	napi*;
	node_api_*;
	node_module_register;

	uv_os_getpid;
	uv_os_getppid;

	extern "C++" {
		v8::*;
		node::*;
	};
    local:
	*;
};
