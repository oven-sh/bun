BUN_1.1 {
    global:
	napi*;
	node_api_*;
	node_module_register;
	extern "C++" {
		v8::*;
		node::*;
		JSC::CallFrame::describeFrame;
	};
    local:
	*;
};
