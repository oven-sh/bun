// The addon of ../process-dlopen-flags.test.ts and of test/js/node/process/dlopen-duplicate-load.test.ts. What it answers depends
// on the mode that dlopen() opened it with. Windows has no such mode: node-gyp compiles this there too, to nothing.
#ifndef _WIN32
#define _GNU_SOURCE
#include <dlfcn.h>
#include <signal.h>
#include <node_api.h>

// ./plugin.c calls this. The loader finds it for the plugin only if this addon was opened with RTLD_GLOBAL.
NAPI_MODULE_EXPORT int core_value(void) { return 42; }

// Opens the library at the path and returns its plugin_value(), or the loader's error text.
static napi_value load_plugin(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value path_value, result;
    char path[4096];
    napi_get_cb_info(env, info, &argc, &path_value, NULL, NULL);
    napi_get_value_string_utf8(env, path_value, path, sizeof(path), NULL);
    void* handle = dlopen(path, RTLD_NOW);
    if (!handle) {
        napi_create_string_utf8(env, dlerror(), NAPI_AUTO_LENGTH, &result);
        return result;
    }
    int (*plugin_value)(void) = (int (*)(void))dlsym(handle, "plugin_value");
    napi_create_int32(env, plugin_value(), &result);
    return result;
}

// Whether the signal() that this addon calls is defined by the program that loaded it, which defines every function of Node-API.
static napi_value signal_is_the_programs_own(napi_env env, napi_callback_info info)
{
    Dl_info of_signal, of_program;
    napi_value result;
    int found = dladdr((void*)&signal, &of_signal) && dladdr((void*)&napi_get_boolean, &of_program);
    napi_get_boolean(env, found && of_signal.dli_fbase == of_program.dli_fbase, &result);
    return result;
}

// Sets the default action for the signal, as a library does that knows nothing of the program around it.
static napi_value set_default_action(napi_env env, napi_callback_info info)
{
    size_t argc = 1;
    napi_value number_value;
    int32_t number;
    napi_get_cb_info(env, info, &argc, &number_value, NULL, NULL);
    napi_get_value_int32(env, number_value, &number);
    signal(number, SIG_DFL);
    return NULL;
}

NAPI_MODULE_INIT()
{
    napi_value function;
    napi_create_function(env, "loadPlugin", NAPI_AUTO_LENGTH, load_plugin, NULL, &function);
    napi_set_named_property(env, exports, "loadPlugin", function);
    napi_create_function(env, "signalIsTheProgramsOwn", NAPI_AUTO_LENGTH, signal_is_the_programs_own, NULL, &function);
    napi_set_named_property(env, exports, "signalIsTheProgramsOwn", function);
    napi_create_function(env, "setDefaultAction", NAPI_AUTO_LENGTH, set_default_action, NULL, &function);
    napi_set_named_property(env, exports, "setDefaultAction", function);
    return exports;
}
#endif
