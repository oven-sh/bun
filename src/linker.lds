BUN_1.1 {
    global:
	napi*;
	node_api_*;
	extern "C++" {
		v8::*;
		node::*;
	};
    local:
	*;
};
