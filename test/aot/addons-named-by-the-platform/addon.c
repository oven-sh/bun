#include <node_api.h>

static napi_value add(napi_env env, napi_callback_info info)
{
    size_t count = 2;
    napi_value arguments[2];
    napi_get_cb_info(env, info, &count, arguments, NULL, NULL);
    double left = 0, right = 0;
    napi_get_value_double(env, arguments[0], &left);
    napi_get_value_double(env, arguments[1], &right);
    napi_value sum;
    napi_create_double(env, left + right, &sum);
    return sum;
}

NAPI_MODULE_INIT()
{
    napi_value function;
    napi_create_function(env, "add", NAPI_AUTO_LENGTH, add, NULL, &function);
    napi_set_named_property(env, exports, "add", function);
    return exports;
}
