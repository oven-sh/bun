
// GENERATED CODE ... NO TOUCHY!!
#include <node_api.h>

#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <uv.h>

napi_value native_func(napi_env env, napi_callback_info info) {
  napi_value result;
  double number = 0.1;

  napi_status status = napi_create_double(env, number, &result);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to create double!");
    return NULL;
  }

  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_status status;
  napi_value fn_call_uv_func;

  // Register call_uv_func function
  status =
      napi_create_function(env, NULL, 0, native_func, NULL, &fn_call_uv_func);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to create native_func function");
    return NULL;
  }

  status = napi_set_named_property(env, exports, "nativeFunc", fn_call_uv_func);
  if (status != napi_ok) {
    napi_throw_error(env, NULL,
                     "Failed to add native_func function to exports");
    return NULL;
  }

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)