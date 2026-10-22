// An N-API addon for ../napi-addon.test.ts: one export for every call by which an addon looks at or changes a JavaScript object.
// The test builds it with the system's C compiler against the headers in src/runtime/napi. By hand:
//   cc -shared -fPIC -I ../../../src/runtime/napi addon.c -o addon.node     (macOS: add -undefined dynamic_lookup)
// Each export answers with a JavaScript value, or with a string "status <n>" | "threw <message>" where the call failed.
#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static napi_value text(napi_env env, const char* s) { napi_value v; napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v); return v; }
static napi_value boolean(napi_env env, bool b) { napi_value v; napi_get_boolean(env, b, &v); return v; }
static napi_value number(napi_env env, double d) { napi_value v; napi_create_double(env, d, &v); return v; }
static napi_value failed(napi_env env, napi_status status) {
  bool pending = false; napi_is_exception_pending(env, &pending);
  char out[400];
  if (pending) {
    napi_value error, message; char buffer[300] = ""; size_t length = 0;
    napi_get_and_clear_last_exception(env, &error);
    if (napi_get_named_property(env, error, "message", &message) == napi_ok) napi_get_value_string_utf8(env, message, buffer, sizeof buffer, &length);
    char* note = strstr(buffer, " (bun compile"); if (note) *note = 0;
    snprintf(out, sizeof out, "threw %s", buffer);
  } else snprintf(out, sizeof out, "status %d", (int)status);
  return text(env, out);
}
#define ARGS(n) size_t argc = n; napi_value a[n > 0 ? n : 1]; napi_get_cb_info(env, info, &argc, a, NULL, NULL)
#define TRY(call) do { napi_status status_ = (call); if (status_ != napi_ok) return failed(env, status_); } while (0)
#define FN(name) static napi_value name(napi_env env, napi_callback_info info)
static void nameOf(napi_env env, napi_value v, char* buffer, size_t size) { size_t length = 0; buffer[0] = 0; napi_get_value_string_utf8(env, v, buffer, size, &length); }

FN(names) { ARGS(1); napi_value r; TRY(napi_get_property_names(env, a[0], &r)); return r; }
FN(allNames) { ARGS(4); int32_t mode, filter, conversion; napi_get_value_int32(env, a[1], &mode); napi_get_value_int32(env, a[2], &filter); napi_get_value_int32(env, a[3], &conversion); napi_value r;
  TRY(napi_get_all_property_names(env, a[0], (napi_key_collection_mode)mode, (napi_key_filter)filter, (napi_key_conversion)conversion, &r)); return r; }
FN(getNamed) { ARGS(2); char n[100]; nameOf(env, a[1], n, sizeof n); napi_value r; TRY(napi_get_named_property(env, a[0], n, &r)); return r; }
FN(get) { ARGS(2); napi_value r; TRY(napi_get_property(env, a[0], a[1], &r)); return r; }
FN(has) { ARGS(2); bool r; TRY(napi_has_property(env, a[0], a[1], &r)); return boolean(env, r); }
FN(hasOwn) { ARGS(2); bool r; TRY(napi_has_own_property(env, a[0], a[1], &r)); return boolean(env, r); }
FN(hasNamed) { ARGS(2); char n[100]; nameOf(env, a[1], n, sizeof n); bool r; TRY(napi_has_named_property(env, a[0], n, &r)); return boolean(env, r); }
FN(setNamed) { ARGS(3); char n[100]; nameOf(env, a[1], n, sizeof n); TRY(napi_set_named_property(env, a[0], n, a[2])); return text(env, "ok"); }
FN(set) { ARGS(3); TRY(napi_set_property(env, a[0], a[1], a[2])); return text(env, "ok"); }
FN(del) { ARGS(2); bool r; TRY(napi_delete_property(env, a[0], a[1], &r)); return boolean(env, r); }
FN(getElement) { ARGS(2); uint32_t i; napi_get_value_uint32(env, a[1], &i); napi_value r; TRY(napi_get_element(env, a[0], i, &r)); return r; }
FN(setElement) { ARGS(3); uint32_t i; napi_get_value_uint32(env, a[1], &i); TRY(napi_set_element(env, a[0], i, a[2])); return text(env, "ok"); }
FN(hasElement) { ARGS(2); uint32_t i; napi_get_value_uint32(env, a[1], &i); bool r; TRY(napi_has_element(env, a[0], i, &r)); return boolean(env, r); }
FN(deleteElement) { ARGS(2); uint32_t i; napi_get_value_uint32(env, a[1], &i); bool r; TRY(napi_delete_element(env, a[0], i, &r)); return boolean(env, r); }
static napi_value seven(napi_env env, napi_callback_info info) { (void)info; return number(env, 7); }
static napi_value swallow(napi_env env, napi_callback_info info) { (void)info; napi_value u; napi_get_undefined(env, &u); return u; }
// defineValue(o, name, value, attributes) | defineMethod(o, name) | defineAccessor(o, name)
FN(defineValue) { ARGS(4); char n[100]; nameOf(env, a[1], n, sizeof n); int32_t attributes; napi_get_value_int32(env, a[3], &attributes);
  napi_property_descriptor d = { n, NULL, NULL, NULL, NULL, a[2], (napi_property_attributes)attributes, NULL }; TRY(napi_define_properties(env, a[0], 1, &d)); return text(env, "ok"); }
FN(defineMethod) { ARGS(2); char n[100]; nameOf(env, a[1], n, sizeof n);
  napi_property_descriptor d = { n, NULL, seven, NULL, NULL, NULL, napi_default_method, NULL }; TRY(napi_define_properties(env, a[0], 1, &d)); return text(env, "ok"); }
FN(defineAccessor) { ARGS(2); char n[100]; nameOf(env, a[1], n, sizeof n);
  napi_property_descriptor d = { n, NULL, NULL, seven, swallow, NULL, napi_default_jsproperty, NULL }; TRY(napi_define_properties(env, a[0], 1, &d)); return text(env, "ok"); }
FN(freeze) { ARGS(1); TRY(napi_object_freeze(env, a[0])); return text(env, "ok"); }
FN(seal) { ARGS(1); TRY(napi_object_seal(env, a[0])); return text(env, "ok"); }
static int finalized = 0;
FN(finalizedSoFar) { ARGS(0); return number(env, finalized); }
static void finalize(napi_env env, void* data, void* hint) { (void)env; (void)hint; finalized++; free(data); }
FN(wrap) { ARGS(2); double* box = malloc(sizeof(double)); napi_get_value_double(env, a[1], box); napi_status s = napi_wrap(env, a[0], box, finalize, NULL, NULL); if (s != napi_ok) { free(box); return failed(env, s); } return text(env, "ok"); }
FN(unwrap) { ARGS(1); void* box; TRY(napi_unwrap(env, a[0], &box)); return number(env, *(double*)box); }
FN(removeWrap) { ARGS(1); void* box; TRY(napi_remove_wrap(env, a[0], &box)); double d = *(double*)box; free(box); return number(env, d); }
static const napi_type_tag tagOne = { 0x1edf75a38336451dULL, 0xa5ed9ce2e4c00c38ULL }, tagTwo = { 0x9c73317f9fad44a3ULL, 0x93c3920bf3b0ad6aULL };
FN(tag) { ARGS(2); int32_t which; napi_get_value_int32(env, a[1], &which); TRY(napi_type_tag_object(env, a[0], which == 1 ? &tagOne : &tagTwo)); return text(env, "ok"); }
FN(checkTag) { ARGS(2); int32_t which; napi_get_value_int32(env, a[1], &which); bool r; TRY(napi_check_object_type_tag(env, a[0], which == 1 ? &tagOne : &tagTwo, &r)); return boolean(env, r); }
FN(instanceOf) { ARGS(2); bool r; TRY(napi_instanceof(env, a[0], a[1], &r)); return boolean(env, r); }
FN(strictEquals) { ARGS(2); bool r; TRY(napi_strict_equals(env, a[0], a[1], &r)); return boolean(env, r); }
FN(coerceToObject) { ARGS(1); napi_value r; TRY(napi_coerce_to_object(env, a[0], &r)); return r; }
FN(coerceToString) { ARGS(1); napi_value r; TRY(napi_coerce_to_string(env, a[0], &r)); return r; }
FN(prototypeOf) { ARGS(1); napi_value r; TRY(napi_get_prototype(env, a[0], &r)); return r; }
FN(typeOf) { ARGS(1); napi_valuetype t; TRY(napi_typeof(env, a[0], &t)); static const char* const words[] = { "undefined", "null", "boolean", "number", "string", "symbol", "object", "function", "external", "bigint" }; return text(env, words[t]); }
FN(kinds) { ARGS(1); bool array, buffer, typed, arraybuffer, date, error, promise, dataview; char out[200];
  TRY(napi_is_array(env, a[0], &array)); TRY(napi_is_buffer(env, a[0], &buffer)); TRY(napi_is_typedarray(env, a[0], &typed)); TRY(napi_is_arraybuffer(env, a[0], &arraybuffer)); TRY(napi_is_date(env, a[0], &date)); TRY(napi_is_error(env, a[0], &error)); TRY(napi_is_promise(env, a[0], &promise)); TRY(napi_is_dataview(env, a[0], &dataview));
  snprintf(out, sizeof out, "array %d buffer %d typedarray %d arraybuffer %d date %d error %d promise %d dataview %d", array, buffer, typed, arraybuffer, date, error, promise, dataview); return text(env, out); }
// The sum of the bytes of the typed array that the object holds under the name, each then raised by one: what an image or hash addon does with `options.data`.
FN(sumBytesOf) { ARGS(2); char n[100]; nameOf(env, a[1], n, sizeof n); napi_value field; TRY(napi_get_named_property(env, a[0], n, &field));
  napi_typedarray_type type; size_t length; void* data; napi_value buffer; size_t offset; TRY(napi_get_typedarray_info(env, field, &type, &length, &data, &buffer, &offset));
  double sum = 0; for (size_t i = 0; i < length; i++) { sum += ((uint8_t*)data)[i]; ((uint8_t*)data)[i]++; } return number(env, sum); }
FN(lengthOfArrayAt) { ARGS(2); char n[100]; nameOf(env, a[1], n, sizeof n); napi_value field; TRY(napi_get_named_property(env, a[0], n, &field)); uint32_t length; TRY(napi_get_array_length(env, field, &length)); return number(env, length); }
static napi_ref kept;
FN(keep) { ARGS(1); TRY(napi_create_reference(env, a[0], 1, &kept)); return text(env, "ok"); }
FN(keptValue) { ARGS(0); napi_value r; TRY(napi_get_reference_value(env, kept, &r)); return r; }
FN(dropKept) { ARGS(0); TRY(napi_delete_reference(env, kept)); return text(env, "ok"); }
FN(addFinalizer) { ARGS(1); TRY(napi_add_finalizer(env, a[0], malloc(8), finalize, NULL, NULL)); return text(env, "ok"); }
FN(construct) { ARGS(3); napi_value r; TRY(napi_new_instance(env, a[0], 2, a + 1, &r)); return r; }
FN(call) { ARGS(3); napi_value r; TRY(napi_call_function(env, a[0], a[1], 1, a + 2, &r)); return r; }
// callMethod(o, name, argument): what an addon does with a callback in an options bag
FN(callMethod) { ARGS(3); char n[100]; nameOf(env, a[1], n, sizeof n); napi_value f, r; TRY(napi_get_named_property(env, a[0], n, &f)); TRY(napi_call_function(env, a[0], f, 1, a + 2, &r)); return r; }
// An options bag read the way better-sqlite3 | sharp | bcrypt read theirs: each name asked for, its kind looked at, its value taken.
FN(readOptions) { ARGS(1); char out[400]; napi_value v; napi_valuetype t; double width = -1; bool fast = false; char name[60] = "?"; size_t length; bool hasName = false, hasExtra = false;
  TRY(napi_get_named_property(env, a[0], "width", &v)); TRY(napi_typeof(env, v, &t)); if (t == napi_number) napi_get_value_double(env, v, &width);
  TRY(napi_get_named_property(env, a[0], "fast", &v)); TRY(napi_typeof(env, v, &t)); if (t == napi_boolean) napi_get_value_bool(env, v, &fast);
  TRY(napi_has_named_property(env, a[0], "name", &hasName)); if (hasName) { TRY(napi_get_named_property(env, a[0], "name", &v)); napi_get_value_string_utf8(env, v, name, sizeof name, &length); }
  TRY(napi_has_named_property(env, a[0], "extra", &hasExtra));
  snprintf(out, sizeof out, "width %g fast %d name %s hasName %d hasExtra %d", width, fast, name, hasName, hasExtra); return text(env, out); }
// A row made by the addon, as a database addon hands rows out.
FN(makeRow) { ARGS(0); napi_value row, list; TRY(napi_create_object(env, &row)); TRY(napi_set_named_property(env, row, "id", number(env, 1))); TRY(napi_set_named_property(env, row, "name", text(env, "n")));
  TRY(napi_create_array_with_length(env, 2, &list)); TRY(napi_set_element(env, list, 0, number(env, 1))); TRY(napi_set_element(env, list, 1, number(env, 2))); TRY(napi_set_named_property(env, row, "list", list)); return row; }

// Rows in an array, each with an object below it: all made by napi_create_object().
FN(makeRows) { ARGS(0); napi_value all; TRY(napi_create_array(env, &all));
  for (uint32_t i = 0; i < 2; i++) { napi_value row, inner; TRY(napi_create_object(env, &row)); TRY(napi_create_object(env, &inner)); TRY(napi_set_named_property(env, inner, "x", number(env, i))); TRY(napi_set_named_property(env, inner, "tag", text(env, "t")));
    TRY(napi_set_named_property(env, row, "id", number(env, i))); TRY(napi_set_named_property(env, row, "inner", inner)); TRY(napi_set_element(env, all, i, row)); }
  return all; }

// A class of the addon's: new Counter(start): the native half is wrapped into `this`; increment(by), get | set value, static made().
static int countersMade = 0;
static void freeCounter(napi_env env, void* data, void* hint) { (void)env; (void)hint; free(data); }
static napi_value counterNew(napi_env env, napi_callback_info info) { size_t argc = 1; napi_value a[1], self; napi_get_cb_info(env, info, &argc, a, &self, NULL); double* box = malloc(sizeof(double)); *box = 0; if (argc > 0) napi_get_value_double(env, a[0], box);
  napi_status s = napi_wrap(env, self, box, freeCounter, NULL, NULL); if (s != napi_ok) { free(box); napi_throw_error(env, NULL, "wrap failed"); return NULL; } countersMade++; return self; }
static napi_value counterIncrement(napi_env env, napi_callback_info info) { size_t argc = 1; napi_value a[1], self; napi_get_cb_info(env, info, &argc, a, &self, NULL); void* box; TRY(napi_unwrap(env, self, &box)); double by = 1; if (argc > 0) napi_get_value_double(env, a[0], &by); *(double*)box += by; return number(env, *(double*)box); }
static napi_value counterGet(napi_env env, napi_callback_info info) { napi_value self; napi_get_cb_info(env, info, NULL, NULL, &self, NULL); void* box; TRY(napi_unwrap(env, self, &box)); return number(env, *(double*)box); }
static napi_value counterSet(napi_env env, napi_callback_info info) { size_t argc = 1; napi_value a[1], self; napi_get_cb_info(env, info, &argc, a, &self, NULL); void* box; TRY(napi_unwrap(env, self, &box)); napi_get_value_double(env, a[0], (double*)box); return self; }
static napi_value counterMade(napi_env env, napi_callback_info info) { (void)info; return number(env, countersMade); }
// What lies under a name, by its kind: a Date's time, a Buffer's length and first byte, a bigint's words, a string's length.
FN(valueAt) { ARGS(2); char n[100], out[200]; nameOf(env, a[1], n, sizeof n); napi_value v; TRY(napi_get_named_property(env, a[0], n, &v)); bool is;
  TRY(napi_is_date(env, v, &is)); if (is) { double time; TRY(napi_get_date_value(env, v, &time)); snprintf(out, sizeof out, "date %g", time); return text(env, out); }
  TRY(napi_is_buffer(env, v, &is)); if (is) { void* data; size_t length; TRY(napi_get_buffer_info(env, v, &data, &length)); snprintf(out, sizeof out, "buffer %zu first %d", length, length ? ((uint8_t*)data)[0] : -1); return text(env, out); }
  napi_valuetype t; TRY(napi_typeof(env, v, &t));
  if (t == napi_bigint) { int64_t i; bool lossless; TRY(napi_get_value_bigint_int64(env, v, &i, &lossless)); snprintf(out, sizeof out, "bigint %lld lossless %d", (long long)i, lossless); return text(env, out); }
  if (t == napi_string) { size_t length; TRY(napi_get_value_string_utf8(env, v, NULL, 0, &length)); snprintf(out, sizeof out, "string %zu", length); return text(env, out); }
  if (t == napi_number) { int32_t i; TRY(napi_get_value_int32(env, v, &i)); snprintf(out, sizeof out, "int32 %d", i); return text(env, out); }
  if (t == napi_external) { void* data; TRY(napi_get_value_external(env, v, &data)); snprintf(out, sizeof out, "external %d", *(int*)data); return text(env, out); }
  snprintf(out, sizeof out, "type %d", (int)t); return text(env, out); }
static int eleven = 11;
FN(makeExternal) { ARGS(0); napi_value r; TRY(napi_create_external(env, &eleven, NULL, NULL, &r)); return r; }
// Fills the object it is handed, as an addon that is given a result object to write into.
FN(fill) { ARGS(1); TRY(napi_set_named_property(env, a[0], "id", number(env, 5))); TRY(napi_set_named_property(env, a[0], "name", text(env, "filled"))); return a[0]; }

NAPI_MODULE_INIT() {
#define EXPORT(name) do { napi_value f; napi_create_function(env, #name, NAPI_AUTO_LENGTH, name, NULL, &f); napi_set_named_property(env, exports, #name, f); } while (0)
  EXPORT(names); EXPORT(allNames); EXPORT(getNamed); EXPORT(get); EXPORT(has); EXPORT(hasOwn); EXPORT(hasNamed); EXPORT(setNamed); EXPORT(set); EXPORT(del);
  EXPORT(getElement); EXPORT(setElement); EXPORT(hasElement); EXPORT(deleteElement); EXPORT(defineValue); EXPORT(defineMethod); EXPORT(defineAccessor); EXPORT(freeze); EXPORT(seal);
  EXPORT(wrap); EXPORT(unwrap); EXPORT(removeWrap); EXPORT(tag); EXPORT(checkTag); EXPORT(instanceOf); EXPORT(strictEquals); EXPORT(coerceToObject); EXPORT(coerceToString); EXPORT(prototypeOf); EXPORT(typeOf); EXPORT(kinds);
  EXPORT(sumBytesOf); EXPORT(lengthOfArrayAt); EXPORT(keep); EXPORT(keptValue); EXPORT(dropKept); EXPORT(addFinalizer); EXPORT(construct); EXPORT(call); EXPORT(callMethod); EXPORT(readOptions); EXPORT(makeRow); EXPORT(makeRows); EXPORT(finalizedSoFar);
  EXPORT(valueAt); EXPORT(makeExternal); EXPORT(fill);
  napi_property_descriptor members[] = {
    { "increment", NULL, counterIncrement, NULL, NULL, NULL, napi_default_method, NULL },
    { "value", NULL, NULL, counterGet, counterSet, NULL, napi_default_jsproperty, NULL },
    { "made", NULL, counterMade, NULL, NULL, NULL, (napi_property_attributes)(napi_default_method | napi_static), NULL },
  };
  napi_value counter; napi_define_class(env, "Counter", NAPI_AUTO_LENGTH, counterNew, NULL, 3, members, &counter); napi_set_named_property(env, exports, "Counter", counter);
  return exports;
}
