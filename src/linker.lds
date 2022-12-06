GLIBC_2.2.5 {
   fcntl;
};


BUN_0.3 {
    global:
	napi*;
	__cxa_atexit;
	__cxa_thread_atexit_impl;
    local:
	*;
};
