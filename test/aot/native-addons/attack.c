// An N-API addon for ../native-addons.test.ts that does to a compiled program what native code may do: it holds, calls and changes what it is handed and what that reaches,
// at once and later, and it reads, calls and changes globals by name. The test builds it with the system's C compiler against the headers in src/runtime/napi. By hand:
//   cc -shared -fPIC -I ../../../src/runtime/napi attack.c -o attack.node -lpthread     (macOS: add -undefined dynamic_lookup)
// Each export answers with a JavaScript value, or with a string "status <n>" | "threw <name>: <message>" where a call failed.
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <pthread.h>
#endif

static napi_value text(napi_env env, const char* s) { napi_value v; napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v); return v; }
static napi_value number(napi_env env, double d) { napi_value v; napi_create_double(env, d, &v); return v; }
static napi_value boolean(napi_env env, bool b) { napi_value v; napi_get_boolean(env, b, &v); return v; }
static napi_value undefined(napi_env env) { napi_value v; napi_get_undefined(env, &v); return v; }
static void textOf(napi_env env, napi_value v, char* buffer, size_t size) { size_t length = 0; buffer[0] = 0; napi_get_value_string_utf8(env, v, buffer, size, &length); }
static napi_value failed(napi_env env, napi_status status) {
  bool pending = false; napi_is_exception_pending(env, &pending);
  char out[500];
  if (pending) {
    napi_value error, part; char name[60] = "", message[300] = "";
    napi_get_and_clear_last_exception(env, &error);
    if (napi_get_named_property(env, error, "name", &part) == napi_ok) textOf(env, part, name, sizeof name);
    if (napi_get_named_property(env, error, "message", &part) == napi_ok) textOf(env, part, message, sizeof message);
    char* note = strstr(message, " (bun compile"); if (note) *note = 0;
    snprintf(out, sizeof out, "threw %s: %s", name, message);
  } else snprintf(out, sizeof out, "status %d", (int)status);
  return text(env, out);
}
#define ARGS(n) size_t argc = n; napi_value a[n]; napi_get_cb_info(env, info, &argc, a, NULL, NULL)
#define TRY(call) do { napi_status status_ = (call); if (status_ != napi_ok) return failed(env, status_); } while (0)
#define FN(name) static napi_value name(napi_env env, napi_callback_info info)

static napi_status globalNamed(napi_env env, const char* name, napi_value* result) {
  napi_value global; napi_status status = napi_get_global(env, &global);
  return status == napi_ok ? napi_get_named_property(env, global, name, result) : status;
}
// Object.<method>(..arguments), with Object read off the global object.
static napi_status callObjectMethod(napi_env env, const char* method, size_t count, const napi_value* arguments, napi_value* result) {
  napi_value object, function; napi_status status = globalNamed(env, "Object", &object);
  if (status == napi_ok) status = napi_get_named_property(env, object, method, &function);
  return status == napi_ok ? napi_call_function(env, object, function, count, arguments, result) : status;
}

// What is handed in, changed at once.
FN(store) { ARGS(3); TRY(napi_set_property(env, a[0], a[1], a[2])); return text(env, "ok"); }
FN(storeNamed) { ARGS(3); char n[100]; textOf(env, a[1], n, sizeof n); TRY(napi_set_named_property(env, a[0], n, a[2])); return text(env, "ok"); }
FN(storeElement) { ARGS(3); uint32_t i; napi_get_value_uint32(env, a[1], &i); TRY(napi_set_element(env, a[0], i, a[2])); return text(env, "ok"); }
FN(read) { ARGS(2); napi_value r; TRY(napi_get_property(env, a[0], a[1], &r)); return r; }
FN(removeKey) { ARGS(2); bool r; TRY(napi_delete_property(env, a[0], a[1], &r)); return boolean(env, r); }
static napi_value answersSeven(napi_env env, napi_callback_info info) { (void)info; return number(env, 7); }
static napi_value swallows(napi_env env, napi_callback_info info) { (void)info; return undefined(env); }
FN(defineGetter) { ARGS(2); char n[100]; textOf(env, a[1], n, sizeof n);
  napi_property_descriptor d = { n, NULL, NULL, answersSeven, swallows, NULL, napi_default_jsproperty, NULL }; TRY(napi_define_properties(env, a[0], 1, &d)); return text(env, "ok"); }
FN(defineMethod) { ARGS(2); char n[100]; textOf(env, a[1], n, sizeof n);
  napi_property_descriptor d = { n, NULL, answersSeven, NULL, NULL, NULL, napi_default_method, NULL }; TRY(napi_define_properties(env, a[0], 1, &d)); return text(env, "ok"); }
FN(defineValue) { ARGS(4); char n[100]; textOf(env, a[1], n, sizeof n); int32_t attributes; napi_get_value_int32(env, a[3], &attributes);
  napi_property_descriptor d = { n, NULL, NULL, NULL, NULL, a[2], (napi_property_attributes)attributes, NULL }; TRY(napi_define_properties(env, a[0], 1, &d)); return text(env, "ok"); }
FN(setPrototype) { ARGS(2); napi_value r; TRY(callObjectMethod(env, "setPrototypeOf", 2, a, &r)); return text(env, "ok"); }
FN(prototypeOf) { ARGS(1); napi_value r; TRY(napi_get_prototype(env, a[0], &r)); return r; }
FN(freeze) { ARGS(1); TRY(napi_object_freeze(env, a[0])); return text(env, "ok"); }
FN(seal) { ARGS(1); TRY(napi_object_seal(env, a[0])); return text(env, "ok"); }
FN(preventExtensions) { ARGS(1); napi_value r; TRY(callObjectMethod(env, "preventExtensions", 1, a, &r)); return text(env, "ok"); }
// What the handed value reaches: o[via][key] = value | Object.getPrototypeOf(o)[key] = value | f()[key] = value.
FN(storeInto) { ARGS(4); napi_value inner; TRY(napi_get_property(env, a[0], a[1], &inner)); TRY(napi_set_property(env, inner, a[2], a[3])); return text(env, "ok"); }
FN(storeIntoPrototypeOf) { ARGS(3); napi_value prototype; TRY(napi_get_prototype(env, a[0], &prototype)); TRY(napi_set_property(env, prototype, a[1], a[2])); return text(env, "ok"); }
FN(callAndStore) { ARGS(3); napi_value made; TRY(napi_call_function(env, undefined(env), a[0], 0, NULL, &made)); TRY(napi_set_property(env, made, a[1], a[2])); return text(env, "ok"); }
FN(call) { ARGS(4); napi_value r; TRY(napi_call_function(env, a[0], a[1], argc > 2 ? argc - 2 : 0, a + 2, &r)); return r; }
FN(construct) { ARGS(3); napi_value r; TRY(napi_new_instance(env, a[0], argc > 1 ? argc - 1 : 0, a + 1, &r)); return r; }
static void releases(napi_env env, void* data, void* hint) { (void)env; (void)hint; free(data); }
FN(wrap) { ARGS(2); double* box = malloc(sizeof(double)); napi_get_value_double(env, a[1], box);
  napi_status status = napi_wrap(env, a[0], box, releases, NULL, NULL); if (status != napi_ok) { free(box); return failed(env, status); } return text(env, "ok"); }
FN(unwrap) { ARGS(1); void* box; TRY(napi_unwrap(env, a[0], &box)); return number(env, *(double*)box); }

// `this` is handed in too: storeIntoThis(key, value) as a method of any object, and the constructor of a class that the addon defines, which classes of the program extend.
FN(storeIntoThis) { size_t argc = 2; napi_value a[2], self; napi_get_cb_info(env, info, &argc, a, &self, NULL); TRY(napi_set_property(env, self, a[0], a[1])); return self; }
static napi_ref lastConstructed;
static napi_value constructsBase(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value a[1], self; napi_get_cb_info(env, info, &argc, a, &self, NULL);
  napi_set_named_property(env, self, "fromBase", argc ? a[0] : undefined(env));
  if (lastConstructed) napi_delete_reference(env, lastConstructed);
  napi_create_reference(env, self, 1, &lastConstructed);
  return self;
}
FN(storeIntoLastConstructed) { ARGS(2); napi_value o; TRY(napi_get_reference_value(env, lastConstructed, &o)); TRY(napi_set_property(env, o, a[0], a[1])); return text(env, "ok"); }
static napi_value baseMethod(napi_env env, napi_callback_info info) {
  napi_value self, r; napi_get_cb_info(env, info, NULL, NULL, &self, NULL); TRY(napi_get_named_property(env, self, "fromBase", &r)); return r; }

// Memory behind a view, written without a call that names an element, and taken away.
FN(poke) { ARGS(3); void* data; size_t length; napi_typedarray_type type; uint32_t i; int32_t value; napi_get_value_uint32(env, a[1], &i); napi_get_value_int32(env, a[2], &value);
  TRY(napi_get_typedarray_info(env, a[0], &type, &length, &data, NULL, NULL));
  if (i >= length) return text(env, "outside");
  switch (type) {
  case napi_uint8_array: ((uint8_t*)data)[i] = (uint8_t)value; break;
  case napi_int32_array: ((int32_t*)data)[i] = value; break;
  case napi_float64_array: ((double*)data)[i] = value + 0.5; break;
  default: return text(env, "another kind"); }
  return text(env, "ok"); }
FN(detach) { ARGS(1); TRY(napi_detach_arraybuffer(env, a[0])); return text(env, "ok"); }

// What the addon makes and hands out.
FN(makeRecord) { ARGS(1); napi_value o, list; TRY(napi_create_object(env, &o)); TRY(napi_create_array_with_length(env, 2, &list)); napi_set_element(env, list, 0, number(env, 1)); napi_set_element(env, list, 1, a[0]);
  napi_set_named_property(env, o, "x", number(env, 1)); napi_set_named_property(env, o, "y", number(env, 2.5)); napi_set_named_property(env, o, "list", list); napi_set_named_property(env, o, "handed", a[0]); return o; }
FN(throws) { ARGS(1); char m[100]; textOf(env, a[0], m, sizeof m); napi_throw_range_error(env, "ERR_ATTACK", m); return NULL; }
FN(throwsValue) { ARGS(1); napi_throw(env, a[0]); return NULL; }
struct promised { napi_async_work work; napi_deferred deferred; napi_ref value; };
static void settles(napi_env env, napi_status status, void* data) {
  struct promised* promised = data; napi_value value; (void)status;
  napi_handle_scope scope; napi_open_handle_scope(env, &scope);
  napi_get_reference_value(env, promised->value, &value); napi_resolve_deferred(env, promised->deferred, value); napi_delete_reference(env, promised->value);
  napi_close_handle_scope(env, scope);
  napi_delete_async_work(env, promised->work); free(promised);
}
static void waitsForNothing(napi_env env, void* data) { (void)env; (void)data; }
// resolvesLater(value): a promise that work on the thread pool resolves with the value.
FN(resolvesLater) { ARGS(1); struct promised* promised = calloc(1, sizeof *promised); napi_value promise;
  TRY(napi_create_promise(env, &promised->deferred, &promise)); TRY(napi_create_reference(env, a[0], 1, &promised->value));
  TRY(napi_create_async_work(env, NULL, text(env, "attack"), waitsForNothing, settles, promised, &promised->work)); TRY(napi_queue_async_work(env, promised->work)); return promise; }

// What was handed in once, used in a later call, from the event loop and from another thread.
#define KEPT 8
static napi_ref kept[KEPT];
static napi_status keptAt(napi_env env, napi_value index, napi_value* result) {
  uint32_t i = 0; napi_get_value_uint32(env, index, &i);
  return i < KEPT && kept[i] ? napi_get_reference_value(env, kept[i], result) : napi_invalid_arg;
}
FN(keep) { ARGS(2); uint32_t i = 0; napi_get_value_uint32(env, a[0], &i); if (i >= KEPT) return failed(env, napi_invalid_arg);
  if (kept[i]) napi_delete_reference(env, kept[i]);
  TRY(napi_create_reference(env, a[1], 1, &kept[i])); return text(env, "ok"); }
FN(keptValue) { ARGS(1); napi_value r; TRY(keptAt(env, a[0], &r)); return r; }
FN(storeIntoKept) { ARGS(3); napi_value o; TRY(keptAt(env, a[0], &o)); TRY(napi_set_property(env, o, a[1], a[2])); return text(env, "ok"); }
FN(removeFromKept) { ARGS(2); napi_value o; bool r; TRY(keptAt(env, a[0], &o)); TRY(napi_delete_property(env, o, a[1], &r)); return boolean(env, r); }
FN(callKept) { ARGS(3); napi_value f, r; TRY(keptAt(env, a[0], &f)); TRY(napi_call_function(env, undefined(env), f, argc > 1 ? argc - 1 : 0, a + 1, &r)); return r; }

struct later { napi_async_work work; uint32_t index; double argument; };
static void waits(napi_env env, void* data) { (void)env; (void)data; }
static void callsKept(napi_env env, napi_status status, void* data) {
  struct later* later = data; napi_value f, argument = number(env, later->argument), r; (void)status;
  napi_handle_scope scope; napi_open_handle_scope(env, &scope);
  if (napi_get_reference_value(env, kept[later->index], &f) == napi_ok) napi_call_function(env, undefined(env), f, 1, &argument, &r);
  napi_close_handle_scope(env, scope);
  napi_delete_async_work(env, later->work); free(later);
}
// callKeptFromWork(index, number): the kept function is called with the number when the work is complete, from the event loop.
FN(callKeptFromWork) { ARGS(2); struct later* later = calloc(1, sizeof *later); napi_get_value_uint32(env, a[0], &later->index); napi_get_value_double(env, a[1], &later->argument);
  TRY(napi_create_async_work(env, NULL, text(env, "attack"), waits, callsKept, later, &later->work)); TRY(napi_queue_async_work(env, later->work)); return text(env, "queued"); }

#ifndef _WIN32
static napi_threadsafe_function channel;
static void callsWithNumber(napi_env env, napi_value function, void* context, void* data) {
  (void)context; if (!env) return;
  napi_value argument = number(env, (double)(intptr_t)data), r; napi_call_function(env, undefined(env), function, 1, &argument, &r);
}
static void* sends(void* data) { napi_call_threadsafe_function(channel, data, napi_tsfn_blocking); napi_release_threadsafe_function(channel, napi_tsfn_release); return NULL; }
// callFromThread(f, integer): another thread asks for the call; it happens on the thread of the program.
FN(callFromThread) { ARGS(2); int32_t n = 0; napi_get_value_int32(env, a[1], &n); pthread_t thread;
  TRY(napi_create_threadsafe_function(env, a[0], NULL, text(env, "attack"), 0, 1, NULL, NULL, NULL, callsWithNumber, &channel));
  if (pthread_create(&thread, NULL, sends, (void*)(intptr_t)n)) return text(env, "no thread");
  pthread_detach(thread); return text(env, "sent"); }
#else
FN(callFromThread) { ARGS(2); napi_value r; TRY(napi_call_function(env, undefined(env), a[0], 1, a + 1, &r)); return text(env, "sent"); }
#endif

// What nobody handed in: found by a name on the global object.
FN(readGlobal) { ARGS(1); char n[100]; textOf(env, a[0], n, sizeof n); napi_value r; TRY(globalNamed(env, n, &r)); return r; }
FN(storeGlobal) { ARGS(2); char n[100]; textOf(env, a[0], n, sizeof n); napi_value global; TRY(napi_get_global(env, &global)); TRY(napi_set_named_property(env, global, n, a[1])); return text(env, "ok"); }
FN(storeIntoGlobal) { ARGS(3); char n[100]; textOf(env, a[0], n, sizeof n); napi_value o; TRY(globalNamed(env, n, &o)); TRY(napi_set_property(env, o, a[1], a[2])); return text(env, "ok"); }
FN(removeFromGlobal) { ARGS(2); char n[100]; textOf(env, a[0], n, sizeof n); napi_value o; bool r; TRY(globalNamed(env, n, &o)); TRY(napi_delete_property(env, o, a[1], &r)); return boolean(env, r); }
FN(callGlobal) { ARGS(3); char n[100]; textOf(env, a[0], n, sizeof n); napi_value f, r; TRY(globalNamed(env, n, &f)); TRY(napi_call_function(env, undefined(env), f, argc > 1 ? argc - 1 : 0, a + 1, &r)); return r; }
FN(constructGlobal) { ARGS(3); char n[100]; textOf(env, a[0], n, sizeof n); napi_value c, r; TRY(globalNamed(env, n, &c)); TRY(napi_new_instance(env, c, argc > 1 ? argc - 1 : 0, a + 1, &r)); return r; }
// A walk from the global object that never comes back to the program: atGlobalPath(["process", "mainModule", "exports"]).
static napi_status atGlobalPath(napi_env env, napi_value path, napi_value* result) {
  uint32_t length = 0; napi_status status = napi_get_global(env, result);
  if (status == napi_ok) status = napi_get_array_length(env, path, &length);
  for (uint32_t i = 0; status == napi_ok && i < length; i++) { napi_value key; status = napi_get_element(env, path, i, &key); if (status == napi_ok) status = napi_get_property(env, *result, key, result); }
  return status;
}
FN(typeAtGlobalPath) { ARGS(1); napi_value o; napi_valuetype type; TRY(atGlobalPath(env, a[0], &o)); TRY(napi_typeof(env, o, &type)); return number(env, type); }
FN(storeAtGlobalPath) { ARGS(3); napi_value o; TRY(atGlobalPath(env, a[0], &o)); TRY(napi_set_property(env, o, a[1], a[2])); return text(env, "ok"); }
FN(callMethodAtGlobalPath) { ARGS(4); napi_value o, f, r; TRY(atGlobalPath(env, a[0], &o)); TRY(napi_get_property(env, o, a[1], &f)); TRY(napi_call_function(env, o, f, argc > 2 ? argc - 2 : 0, a + 2, &r)); return r; }
// storeIntoBuiltin("Array", "prototype", key, value): <global>.<member>[key] = value.
FN(storeIntoBuiltin) { ARGS(4); char n[100], m[100]; textOf(env, a[0], n, sizeof n); textOf(env, a[1], m, sizeof m); napi_value holder, o;
  TRY(globalNamed(env, n, &holder)); TRY(napi_get_named_property(env, holder, m, &o)); TRY(napi_set_property(env, o, a[2], a[3])); return text(env, "ok"); }

// Text that nobody has seen.
FN(runScript) { ARGS(1); napi_value r; TRY(napi_run_script(env, a[0], &r)); return r; }

NAPI_MODULE_INIT() {
#define EXPORT(name) { #name, NULL, name, NULL, NULL, NULL, napi_default_jsproperty, NULL }
  napi_property_descriptor all[] = {
    EXPORT(store), EXPORT(storeNamed), EXPORT(storeElement), EXPORT(read), EXPORT(removeKey), EXPORT(defineGetter), EXPORT(defineMethod), EXPORT(defineValue), EXPORT(setPrototype),
    EXPORT(prototypeOf), EXPORT(freeze), EXPORT(seal), EXPORT(preventExtensions), EXPORT(storeInto), EXPORT(storeIntoPrototypeOf), EXPORT(callAndStore), EXPORT(call), EXPORT(construct), EXPORT(wrap), EXPORT(unwrap), EXPORT(keep), EXPORT(keptValue),
    EXPORT(storeIntoKept), EXPORT(removeFromKept), EXPORT(callKept), EXPORT(callKeptFromWork), EXPORT(callFromThread), EXPORT(readGlobal), EXPORT(storeGlobal), EXPORT(storeIntoGlobal),
    EXPORT(removeFromGlobal), EXPORT(callGlobal), EXPORT(constructGlobal), EXPORT(typeAtGlobalPath), EXPORT(storeAtGlobalPath), EXPORT(callMethodAtGlobalPath), EXPORT(storeIntoBuiltin), EXPORT(runScript), EXPORT(storeIntoThis), EXPORT(storeIntoLastConstructed),
    EXPORT(poke), EXPORT(detach), EXPORT(makeRecord), EXPORT(throws), EXPORT(throwsValue), EXPORT(resolvesLater),
  };
  // What the exports object holds before the addon is loaded is handed in as well.
  napi_value seed; bool hasSeed = false;
  if (napi_has_named_property(env, exports, "seed", &hasSeed) == napi_ok && hasSeed && napi_get_named_property(env, exports, "seed", &seed) == napi_ok) napi_set_named_property(env, seed, "x", number(env, 41));
  napi_property_descriptor members[] = { { "base", NULL, baseMethod, NULL, NULL, NULL, napi_default_method, NULL } };
  napi_value base;
  if (napi_define_class(env, "Base", NAPI_AUTO_LENGTH, constructsBase, NULL, 1, members, &base) == napi_ok) napi_set_named_property(env, exports, "Base", base);
  napi_define_properties(env, exports, sizeof all / sizeof *all, all);
  return exports;
}
