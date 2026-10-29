// `JSON.stringify` of every kind of value that SerializeJSONProperty tells apart, as a member, an element and at the top: functions, undefined, symbols, bigints, toJSON, boxed primitives, numbers, keys, getters, hidden and private members, unions, subclasses, replacers, indents, cycles, and holders that change while they are written. Each case has its own call site, reached three times.
// STATISTIC: OwnKeyWalksExpanded >= 50
// STATISTIC: SerializersCreated >= 35
// TODO: built one by one the cases get 173 serializers, and the more of them stand in one file the fewer get one.
{
class A { f = () => 1; x = 1 }
function stringify_fn_arrow_field(v) { return JSON.stringify(v) }
function run_fn_arrow_field() {
  let r
  try { r = stringify_fn_arrow_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-arrow-field " + typeof r + " " + String(r))
}
run_fn_arrow_field(); run_fn_arrow_field(); run_fn_arrow_field()
}
{
class A { x = 1; f = () => 1 }
function stringify_fn_arrow_field_last(v) { return JSON.stringify(v) }
function run_fn_arrow_field_last() {
  let r
  try { r = stringify_fn_arrow_field_last(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-arrow-field-last " + typeof r + " " + String(r))
}
run_fn_arrow_field_last(); run_fn_arrow_field_last(); run_fn_arrow_field_last()
}
{
class A { x = 1; f = () => 1; y = "s" }
function stringify_fn_arrow_field_middle(v) { return JSON.stringify(v) }
function run_fn_arrow_field_middle() {
  let r
  try { r = stringify_fn_arrow_field_middle(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-arrow-field-middle " + typeof r + " " + String(r))
}
run_fn_arrow_field_middle(); run_fn_arrow_field_middle(); run_fn_arrow_field_middle()
}
{
class A { f = () => 1 }
function stringify_fn_arrow_field_only(v) { return JSON.stringify(v) }
function run_fn_arrow_field_only() {
  let r
  try { r = stringify_fn_arrow_field_only(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-arrow-field-only " + typeof r + " " + String(r))
}
run_fn_arrow_field_only(); run_fn_arrow_field_only(); run_fn_arrow_field_only()
}
{
class A { f = () => 1; g = () => 2 }
function stringify_fn_two_arrow_fields_only(v) { return JSON.stringify(v) }
function run_fn_two_arrow_fields_only() {
  let r
  try { r = stringify_fn_two_arrow_fields_only(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-two-arrow-fields-only " + typeof r + " " + String(r))
}
run_fn_two_arrow_fields_only(); run_fn_two_arrow_fields_only(); run_fn_two_arrow_fields_only()
}
{
class A { x = 1; f = () => this.x; y = 2 }
function stringify_fn_arrow_captures_this(v) { return JSON.stringify(v) }
function run_fn_arrow_captures_this() {
  let r
  try { r = stringify_fn_arrow_captures_this(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-arrow-captures-this " + typeof r + " " + String(r))
}
run_fn_arrow_captures_this(); run_fn_arrow_captures_this(); run_fn_arrow_captures_this()
}
{
class A { constructor() { this.self = () => this; this.x = 1 } }
function stringify_fn_arrow_in_constructor(v) { return JSON.stringify(v) }
function run_fn_arrow_in_constructor() {
  let r
  try { r = stringify_fn_arrow_in_constructor(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-arrow-in-constructor " + typeof r + " " + String(r))
}
run_fn_arrow_in_constructor(); run_fn_arrow_in_constructor(); run_fn_arrow_in_constructor()
}
{
class A { f = function () { return 1 }; x = 1 }
function stringify_fn_function_expression_field(v) { return JSON.stringify(v) }
function run_fn_function_expression_field() {
  let r
  try { r = stringify_fn_function_expression_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-function-expression-field " + typeof r + " " + String(r))
}
run_fn_function_expression_field(); run_fn_function_expression_field(); run_fn_function_expression_field()
}
{
class A { x = 1; m() { return 1 } }
function stringify_fn_method_on_prototype(v) { return JSON.stringify(v) }
function run_fn_method_on_prototype() {
  let r
  try { r = stringify_fn_method_on_prototype(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-method-on-prototype " + typeof r + " " + String(r))
}
run_fn_method_on_prototype(); run_fn_method_on_prototype(); run_fn_method_on_prototype()
}
{

function stringify_fn_literal_method(v) { return JSON.stringify(v) }
function run_fn_literal_method() {
  let r
  try { r = stringify_fn_literal_method(({ m() { return 1 }, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-literal-method " + typeof r + " " + String(r))
}
run_fn_literal_method(); run_fn_literal_method(); run_fn_literal_method()
}
{

function stringify_fn_literal_arrow(v) { return JSON.stringify(v) }
function run_fn_literal_arrow() {
  let r
  try { r = stringify_fn_literal_arrow(({ f: () => 1, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-literal-arrow " + typeof r + " " + String(r))
}
run_fn_literal_arrow(); run_fn_literal_arrow(); run_fn_literal_arrow()
}
{

function stringify_fn_literal_arrow_last(v) { return JSON.stringify(v) }
function run_fn_literal_arrow_last() {
  let r
  try { r = stringify_fn_literal_arrow_last(({ x: 1, f: () => 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-literal-arrow-last " + typeof r + " " + String(r))
}
run_fn_literal_arrow_last(); run_fn_literal_arrow_last(); run_fn_literal_arrow_last()
}
{

function stringify_fn_literal_only(v) { return JSON.stringify(v) }
function run_fn_literal_only() {
  let r
  try { r = stringify_fn_literal_only(({ f: () => 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-literal-only " + typeof r + " " + String(r))
}
run_fn_literal_only(); run_fn_literal_only(); run_fn_literal_only()
}
{
class A { x = 1 }
function stringify_fn_class_as_member(v) { return JSON.stringify(v) }
function run_fn_class_as_member() {
  let r
  try { r = stringify_fn_class_as_member(({ c: A, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-class-as-member " + typeof r + " " + String(r))
}
run_fn_class_as_member(); run_fn_class_as_member(); run_fn_class_as_member()
}
{
function g() { return 1 }
function stringify_fn_bound(v) { return JSON.stringify(v) }
function run_fn_bound() {
  let r
  try { r = stringify_fn_bound(({ f: g.bind(null), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-bound " + typeof r + " " + String(r))
}
run_fn_bound(); run_fn_bound(); run_fn_bound()
}
{

function stringify_fn_native(v) { return JSON.stringify(v) }
function run_fn_native() {
  let r
  try { r = stringify_fn_native(({ f: Math.max, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-native " + typeof r + " " + String(r))
}
run_fn_native(); run_fn_native(); run_fn_native()
}
{

function stringify_fn_async_and_generator(v) { return JSON.stringify(v) }
function run_fn_async_and_generator() {
  let r
  try { r = stringify_fn_async_and_generator(({ a: async () => 1, g: function* () {}, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-async-and-generator " + typeof r + " " + String(r))
}
run_fn_async_and_generator(); run_fn_async_and_generator(); run_fn_async_and_generator()
}
{
function make() { const f = () => 1; f.toJSON = k => "T:" + k; return f }
function stringify_fn_own_toJSON(v) { return JSON.stringify(v) }
function run_fn_own_toJSON() {
  let r
  try { r = stringify_fn_own_toJSON(({ f: make(), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-own-toJSON " + typeof r + " " + String(r))
}
run_fn_own_toJSON(); run_fn_own_toJSON(); run_fn_own_toJSON()
}
{
function make() { const f = () => 1; f.toJSON = k => "T:" + k; return f }
class A { f = make(); x = 1 }
function stringify_fn_own_toJSON_field(v) { return JSON.stringify(v) }
function run_fn_own_toJSON_field() {
  let r
  try { r = stringify_fn_own_toJSON_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-own-toJSON-field " + typeof r + " " + String(r))
}
run_fn_own_toJSON_field(); run_fn_own_toJSON_field(); run_fn_own_toJSON_field()
}
{

function stringify_fn_root(v) { return JSON.stringify(v) }
function run_fn_root() {
  let r
  try { r = stringify_fn_root((() => 1)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-root " + typeof r + " " + String(r))
}
run_fn_root(); run_fn_root(); run_fn_root()
}
{
class A { x = 1 }
function stringify_fn_root_class(v) { return JSON.stringify(v) }
function run_fn_root_class() {
  let r
  try { r = stringify_fn_root_class(A) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-root-class " + typeof r + " " + String(r))
}
run_fn_root_class(); run_fn_root_class(); run_fn_root_class()
}
{
let n = 0
function stringify_fn_root_or_number(v) { return JSON.stringify(v) }
function run_fn_root_or_number() {
  let r
  try { r = stringify_fn_root_or_number((n++ % 2 ? 5 : () => 1)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-root-or-number " + typeof r + " " + String(r))
}
run_fn_root_or_number(); run_fn_root_or_number(); run_fn_root_or_number()
}
{
let n = 0
class A { x = 1 }
function stringify_fn_root_or_object(v) { return JSON.stringify(v) }
function run_fn_root_or_object() {
  let r
  try { r = stringify_fn_root_or_object((n++ % 2 ? new A() : () => 1)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-root-or-object " + typeof r + " " + String(r))
}
run_fn_root_or_object(); run_fn_root_or_object(); run_fn_root_or_object()
}
{

function stringify_fn_root_concatenated(v) { return "a" + JSON.stringify(v) }
function run_fn_root_concatenated() {
  let r
  try { r = stringify_fn_root_concatenated((() => 1)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-root-concatenated " + typeof r + " " + String(r))
}
run_fn_root_concatenated(); run_fn_root_concatenated(); run_fn_root_concatenated()
}
{

function stringify_fn_root_length(v) { return (() => { try { return JSON.stringify(v).length } catch (e) { return e.name } })() }
function run_fn_root_length() {
  let r
  try { r = stringify_fn_root_length((() => 1)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-root-length " + typeof r + " " + String(r))
}
run_fn_root_length(); run_fn_root_length(); run_fn_root_length()
}
{

function stringify_fn_array(v) { return JSON.stringify(v) }
function run_fn_array() {
  let r
  try { r = stringify_fn_array([() => 1, () => 2]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-array " + typeof r + " " + String(r))
}
run_fn_array(); run_fn_array(); run_fn_array()
}
{

function stringify_fn_array_mixed(v) { return JSON.stringify(v) }
function run_fn_array_mixed() {
  let r
  try { r = stringify_fn_array_mixed([1, () => 1, "a", undefined, Symbol("s"), null, true]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-array-mixed " + typeof r + " " + String(r))
}
run_fn_array_mixed(); run_fn_array_mixed(); run_fn_array_mixed()
}
{

function stringify_fn_array_nested(v) { return JSON.stringify(v) }
function run_fn_array_nested() {
  let r
  try { r = stringify_fn_array_nested(({ a: [[() => 1], [1, () => 2]], x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-array-nested " + typeof r + " " + String(r))
}
run_fn_array_nested(); run_fn_array_nested(); run_fn_array_nested()
}
{
class A { handlers = [() => 1, () => 2]; x = 1 }
function stringify_fn_array_field(v) { return JSON.stringify(v) }
function run_fn_array_field() {
  let r
  try { r = stringify_fn_array_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-array-field " + typeof r + " " + String(r))
}
run_fn_array_field(); run_fn_array_field(); run_fn_array_field()
}
{
class B { f = () => 1; y = 2 }
class A { b = new B(); x = 1 }
function stringify_fn_nested_instance(v) { return JSON.stringify(v) }
function run_fn_nested_instance() {
  let r
  try { r = stringify_fn_nested_instance(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-nested-instance " + typeof r + " " + String(r))
}
run_fn_nested_instance(); run_fn_nested_instance(); run_fn_nested_instance()
}
{
class B { f = () => 1 }
class A { b = new B(); x = 1 }
function stringify_fn_nested_instance_only_functions(v) { return JSON.stringify(v) }
function run_fn_nested_instance_only_functions() {
  let r
  try { r = stringify_fn_nested_instance_only_functions(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-nested-instance-only-functions " + typeof r + " " + String(r))
}
run_fn_nested_instance_only_functions(); run_fn_nested_instance_only_functions(); run_fn_nested_instance_only_functions()
}
{
class B { f = () => 1; y = 2 }
function stringify_fn_array_of_instances(v) { return JSON.stringify(v) }
function run_fn_array_of_instances() {
  let r
  try { r = stringify_fn_array_of_instances([new B(), new B()]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("fn-array-of-instances " + typeof r + " " + String(r))
}
run_fn_array_of_instances(); run_fn_array_of_instances(); run_fn_array_of_instances()
}
{
class A { u = undefined; x = 1 }
function stringify_undefined_field(v) { return JSON.stringify(v) }
function run_undefined_field() {
  let r
  try { r = stringify_undefined_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-field " + typeof r + " " + String(r))
}
run_undefined_field(); run_undefined_field(); run_undefined_field()
}
{
class A { x = 1; u = undefined }
function stringify_undefined_field_last(v) { return JSON.stringify(v) }
function run_undefined_field_last() {
  let r
  try { r = stringify_undefined_field_last(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-field-last " + typeof r + " " + String(r))
}
run_undefined_field_last(); run_undefined_field_last(); run_undefined_field_last()
}
{
class A { u; x = 1 }
function stringify_undefined_field_no_initializer(v) { return JSON.stringify(v) }
function run_undefined_field_no_initializer() {
  let r
  try { r = stringify_undefined_field_no_initializer(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-field-no-initializer " + typeof r + " " + String(r))
}
run_undefined_field_no_initializer(); run_undefined_field_no_initializer(); run_undefined_field_no_initializer()
}
{
class A { u; w = undefined }
function stringify_undefined_all(v) { return JSON.stringify(v) }
function run_undefined_all() {
  let r
  try { r = stringify_undefined_all(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-all " + typeof r + " " + String(r))
}
run_undefined_all(); run_undefined_all(); run_undefined_all()
}
{
let n = 0
class A { constructor(k) { this.x = 1; if (k % 2) this.o = "o"; this.y = 2 } }
function stringify_undefined_sometimes_absent(v) { return JSON.stringify(v) }
function run_undefined_sometimes_absent() {
  let r
  try { r = stringify_undefined_sometimes_absent(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-sometimes-absent " + typeof r + " " + String(r))
}
run_undefined_sometimes_absent(); run_undefined_sometimes_absent(); run_undefined_sometimes_absent()
}
{
let n = 0
class A { constructor(k) { this.x = 1; this.o = k % 2 ? "o" : undefined; this.y = 2 } }
function stringify_undefined_sometimes(v) { return JSON.stringify(v) }
function run_undefined_sometimes() {
  let r
  try { r = stringify_undefined_sometimes(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-sometimes " + typeof r + " " + String(r))
}
run_undefined_sometimes(); run_undefined_sometimes(); run_undefined_sometimes()
}
{

function stringify_undefined_root(v) { return JSON.stringify(v) }
function run_undefined_root() {
  let r
  try { r = stringify_undefined_root(undefined) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-root " + typeof r + " " + String(r))
}
run_undefined_root(); run_undefined_root(); run_undefined_root()
}
{
function nothing() {}
function stringify_undefined_root_void(v) { return JSON.stringify(v) }
function run_undefined_root_void() {
  let r
  try { r = stringify_undefined_root_void(nothing()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-root-void " + typeof r + " " + String(r))
}
run_undefined_root_void(); run_undefined_root_void(); run_undefined_root_void()
}
{

function stringify_undefined_array(v) { return JSON.stringify(v) }
function run_undefined_array() {
  let r
  try { r = stringify_undefined_array([undefined, 1, undefined]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-array " + typeof r + " " + String(r))
}
run_undefined_array(); run_undefined_array(); run_undefined_array()
}
{

function stringify_undefined_holes(v) { return JSON.stringify(v) }
function run_undefined_holes() {
  let r
  try { r = stringify_undefined_holes([1, , 2, , ]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-holes " + typeof r + " " + String(r))
}
run_undefined_holes(); run_undefined_holes(); run_undefined_holes()
}
{

function stringify_undefined_literal(v) { return JSON.stringify(v) }
function run_undefined_literal() {
  let r
  try { r = stringify_undefined_literal(({ a: undefined, b: 1, c: undefined })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("undefined-literal " + typeof r + " " + String(r))
}
run_undefined_literal(); run_undefined_literal(); run_undefined_literal()
}
{
class A { s = Symbol("s"); x = 1 }
function stringify_symbol_field(v) { return JSON.stringify(v) }
function run_symbol_field() {
  let r
  try { r = stringify_symbol_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-field " + typeof r + " " + String(r))
}
run_symbol_field(); run_symbol_field(); run_symbol_field()
}
{
class A { x = 1; s = Symbol.iterator }
function stringify_symbol_field_last(v) { return JSON.stringify(v) }
function run_symbol_field_last() {
  let r
  try { r = stringify_symbol_field_last(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-field-last " + typeof r + " " + String(r))
}
run_symbol_field_last(); run_symbol_field_last(); run_symbol_field_last()
}
{
const k = Symbol("k")
class A { [k] = 1; x = 1 }
function stringify_symbol_key(v) { return JSON.stringify(v) }
function run_symbol_key() {
  let r
  try { r = stringify_symbol_key(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-key " + typeof r + " " + String(r))
}
run_symbol_key(); run_symbol_key(); run_symbol_key()
}
{

function stringify_symbol_key_well_known(v) { return JSON.stringify(v) }
function run_symbol_key_well_known() {
  let r
  try { r = stringify_symbol_key_well_known(({ [Symbol.toStringTag]: "T", x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-key-well-known " + typeof r + " " + String(r))
}
run_symbol_key_well_known(); run_symbol_key_well_known(); run_symbol_key_well_known()
}
{

function stringify_symbol_root(v) { return JSON.stringify(v) }
function run_symbol_root() {
  let r
  try { r = stringify_symbol_root(Symbol("s")) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-root " + typeof r + " " + String(r))
}
run_symbol_root(); run_symbol_root(); run_symbol_root()
}
{

function stringify_symbol_array(v) { return JSON.stringify(v) }
function run_symbol_array() {
  let r
  try { r = stringify_symbol_array([Symbol("a"), Symbol.iterator]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-array " + typeof r + " " + String(r))
}
run_symbol_array(); run_symbol_array(); run_symbol_array()
}
{

function stringify_symbol_boxed(v) { return JSON.stringify(v) }
function run_symbol_boxed() {
  let r
  try { r = stringify_symbol_boxed(({ s: Object(Symbol("s")), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-boxed " + typeof r + " " + String(r))
}
run_symbol_boxed(); run_symbol_boxed(); run_symbol_boxed()
}
{
let n = 0
class A { constructor(k) { this.s = k % 2 ? "s" : Symbol("s"); this.x = 1 } }
function stringify_symbol_or_string(v) { return JSON.stringify(v) }
function run_symbol_or_string() {
  let r
  try { r = stringify_symbol_or_string(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("symbol-or-string " + typeof r + " " + String(r))
}
run_symbol_or_string(); run_symbol_or_string(); run_symbol_or_string()
}
{
class A { b = 1n; x = 1 }
function stringify_bigint_field(v) { return JSON.stringify(v) }
function run_bigint_field() {
  let r
  try { r = stringify_bigint_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("bigint-field " + typeof r + " " + String(r))
}
run_bigint_field(); run_bigint_field(); run_bigint_field()
}
{

function stringify_bigint_root(v) { return JSON.stringify(v) }
function run_bigint_root() {
  let r
  try { r = stringify_bigint_root(1n) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("bigint-root " + typeof r + " " + String(r))
}
run_bigint_root(); run_bigint_root(); run_bigint_root()
}
{

function stringify_bigint_array(v) { return JSON.stringify(v) }
function run_bigint_array() {
  let r
  try { r = stringify_bigint_array([1, 2n]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("bigint-array " + typeof r + " " + String(r))
}
run_bigint_array(); run_bigint_array(); run_bigint_array()
}
{

function stringify_bigint_boxed(v) { return JSON.stringify(v) }
function run_bigint_boxed() {
  let r
  try { r = stringify_bigint_boxed(({ b: Object(1n) })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("bigint-boxed " + typeof r + " " + String(r))
}
run_bigint_boxed(); run_bigint_boxed(); run_bigint_boxed()
}
{
let n = 0
class A { constructor(k) { this.b = k === 2 ? 1n : k; this.x = 1 } }
function stringify_bigint_or_number(v) { return JSON.stringify(v) }
function run_bigint_or_number() {
  let r
  try { r = stringify_bigint_or_number(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("bigint-or-number " + typeof r + " " + String(r))
}
run_bigint_or_number(); run_bigint_or_number(); run_bigint_or_number()
}
{
class A { x = 1; toJSON(k) { return { k: k, x: this.x + 1 } } }
function stringify_toJSON_method(v) { return JSON.stringify(v) }
function run_toJSON_method() {
  let r
  try { r = stringify_toJSON_method(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-method " + typeof r + " " + String(r))
}
run_toJSON_method(); run_toJSON_method(); run_toJSON_method()
}
{
class A { x = 1; toJSON = k => "own:" + k }
function stringify_toJSON_arrow_field(v) { return JSON.stringify(v) }
function run_toJSON_arrow_field() {
  let r
  try { r = stringify_toJSON_arrow_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-arrow-field " + typeof r + " " + String(r))
}
run_toJSON_arrow_field(); run_toJSON_arrow_field(); run_toJSON_arrow_field()
}
{
class B { toJSON(k) { return "key=" + k } }
class A { first = new B(); x = 1; second = new B() }
function stringify_toJSON_member_gets_key(v) { return JSON.stringify(v) }
function run_toJSON_member_gets_key() {
  let r
  try { r = stringify_toJSON_member_gets_key(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-member-gets-key " + typeof r + " " + String(r))
}
run_toJSON_member_gets_key(); run_toJSON_member_gets_key(); run_toJSON_member_gets_key()
}
{
class B { toJSON(k) { return typeof k + ":" + k } }
function stringify_toJSON_element_gets_index(v) { return JSON.stringify(v) }
function run_toJSON_element_gets_index() {
  let r
  try { r = stringify_toJSON_element_gets_index([new B(), new B()]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-element-gets-index " + typeof r + " " + String(r))
}
run_toJSON_element_gets_index(); run_toJSON_element_gets_index(); run_toJSON_element_gets_index()
}
{
class B { toJSON() { return "base" } }
class A extends B { x = 1 }
function stringify_toJSON_inherited(v) { return JSON.stringify(v) }
function run_toJSON_inherited() {
  let r
  try { r = stringify_toJSON_inherited(({ a: new A(), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-inherited " + typeof r + " " + String(r))
}
run_toJSON_inherited(); run_toJSON_inherited(); run_toJSON_inherited()
}
{
class B { y = 1; toJSON() { return "base" } }
class A extends B { x = 1; toJSON() { return "derived" } }
function stringify_toJSON_overridden(v) { return JSON.stringify(v) }
function run_toJSON_overridden() {
  let r
  try { r = stringify_toJSON_overridden([new A(), new B()]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-overridden " + typeof r + " " + String(r))
}
run_toJSON_overridden(); run_toJSON_overridden(); run_toJSON_overridden()
}
{
class A { x = 1; toJSON = 5 }
function stringify_toJSON_not_callable(v) { return JSON.stringify(v) }
function run_toJSON_not_callable() {
  let r
  try { r = stringify_toJSON_not_callable(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-not-callable " + typeof r + " " + String(r))
}
run_toJSON_not_callable(); run_toJSON_not_callable(); run_toJSON_not_callable()
}
{
class B { toJSON() {} }
class A { b = new B(); x = 1 }
function stringify_toJSON_returns_undefined(v) { return JSON.stringify(v) }
function run_toJSON_returns_undefined() {
  let r
  try { r = stringify_toJSON_returns_undefined(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-returns-undefined " + typeof r + " " + String(r))
}
run_toJSON_returns_undefined(); run_toJSON_returns_undefined(); run_toJSON_returns_undefined()
}
{
class B { toJSON() {} }
function stringify_toJSON_returns_undefined_root(v) { return JSON.stringify(v) }
function run_toJSON_returns_undefined_root() {
  let r
  try { r = stringify_toJSON_returns_undefined_root(new B()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-returns-undefined-root " + typeof r + " " + String(r))
}
run_toJSON_returns_undefined_root(); run_toJSON_returns_undefined_root(); run_toJSON_returns_undefined_root()
}
{
class B { toJSON() {} }
function stringify_toJSON_returns_undefined_element(v) { return JSON.stringify(v) }
function run_toJSON_returns_undefined_element() {
  let r
  try { r = stringify_toJSON_returns_undefined_element([new B(), 1]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-returns-undefined-element " + typeof r + " " + String(r))
}
run_toJSON_returns_undefined_element(); run_toJSON_returns_undefined_element(); run_toJSON_returns_undefined_element()
}
{
class B { toJSON() { return () => 1 } }
class A { b = new B(); x = 1 }
function stringify_toJSON_returns_function(v) { return JSON.stringify(v) }
function run_toJSON_returns_function() {
  let r
  try { r = stringify_toJSON_returns_function(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-returns-function " + typeof r + " " + String(r))
}
run_toJSON_returns_function(); run_toJSON_returns_function(); run_toJSON_returns_function()
}
{
class B { toJSON() { return Symbol("s") } }
function stringify_toJSON_returns_symbol_root(v) { return JSON.stringify(v) }
function run_toJSON_returns_symbol_root() {
  let r
  try { r = stringify_toJSON_returns_symbol_root(new B()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-returns-symbol-root " + typeof r + " " + String(r))
}
run_toJSON_returns_symbol_root(); run_toJSON_returns_symbol_root(); run_toJSON_returns_symbol_root()
}
{
class B { toJSON() { return 1n } }
class A { b = new B(); x = 1 }
function stringify_toJSON_returns_bigint(v) { return JSON.stringify(v) }
function run_toJSON_returns_bigint() {
  let r
  try { r = stringify_toJSON_returns_bigint(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-returns-bigint " + typeof r + " " + String(r))
}
run_toJSON_returns_bigint(); run_toJSON_returns_bigint(); run_toJSON_returns_bigint()
}
{
class B { toJSON() { return { toJSON() { return "never" }, y: 1 } } }
function stringify_toJSON_returns_object_with_toJSON(v) { return JSON.stringify(v) }
function run_toJSON_returns_object_with_toJSON() {
  let r
  try { r = stringify_toJSON_returns_object_with_toJSON(({ b: new B() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-returns-object-with-toJSON " + typeof r + " " + String(r))
}
run_toJSON_returns_object_with_toJSON(); run_toJSON_returns_object_with_toJSON(); run_toJSON_returns_object_with_toJSON()
}
{
let reads = 0
class A { x = 1; get toJSON() { reads++; return () => "got" + reads } }
function stringify_toJSON_getter(v) { return JSON.stringify(v) }
function run_toJSON_getter() {
  let r
  try { r = stringify_toJSON_getter(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-getter " + typeof r + " " + String(r))
}
run_toJSON_getter(); run_toJSON_getter(); run_toJSON_getter()
}
{
let n = 0
class A { x = 1 }
function next() { if (++n === 2) A.prototype.toJSON = function () { return "late" }; return new A() }
function stringify_toJSON_added_late(v) { return JSON.stringify(v) }
function run_toJSON_added_late() {
  let r
  try { r = stringify_toJSON_added_late(next()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-added-late " + typeof r + " " + String(r))
}
run_toJSON_added_late(); run_toJSON_added_late(); run_toJSON_added_late()
}
{
let n = 0
class A { x = 1 }
function next() { const a = new A(); if (++n === 2) a.toJSON = () => "late own"; return a }
function stringify_toJSON_added_late_own(v) { return JSON.stringify(v) }
function run_toJSON_added_late_own() {
  let r
  try { r = stringify_toJSON_added_late_own(next()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-added-late-own " + typeof r + " " + String(r))
}
run_toJSON_added_late_own(); run_toJSON_added_late_own(); run_toJSON_added_late_own()
}
{
class B { constructor(h) { this.h = () => h } toJSON() { delete this.h().z; this.h().added = 1; return "b" } }
class A { constructor() { this.x = 1; this.b = new B(this); this.z = 3; this.w = 4 } }
function stringify_toJSON_deletes_later_key(v) { return JSON.stringify(v) }
function run_toJSON_deletes_later_key() {
  let r
  try { r = stringify_toJSON_deletes_later_key(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-deletes-later-key " + typeof r + " " + String(r))
}
run_toJSON_deletes_later_key(); run_toJSON_deletes_later_key(); run_toJSON_deletes_later_key()
}
{
class B { constructor(h) { this.h = () => h } toJSON() { this.h().z = () => 1; this.h().w = "changed"; return "b" } }
class A { constructor() { this.x = 1; this.b = new B(this); this.z = 3; this.w = 4 } }
function stringify_toJSON_changes_later_value(v) { return JSON.stringify(v) }
function run_toJSON_changes_later_value() {
  let r
  try { r = stringify_toJSON_changes_later_value(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-changes-later-value " + typeof r + " " + String(r))
}
run_toJSON_changes_later_value(); run_toJSON_changes_later_value(); run_toJSON_changes_later_value()
}
{
const list = []
class B { toJSON() { list.length = 1; return "b" } }
function make() { list.length = 0; list[0] = new B(); list[1] = 1; list[2] = 2; return list }
function stringify_toJSON_shrinks_array(v) { return JSON.stringify(v) }
function run_toJSON_shrinks_array() {
  let r
  try { r = stringify_toJSON_shrinks_array(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-shrinks-array " + typeof r + " " + String(r))
}
run_toJSON_shrinks_array(); run_toJSON_shrinks_array(); run_toJSON_shrinks_array()
}
{

function stringify_toJSON_date(v) { return JSON.stringify(v) }
function run_toJSON_date() {
  let r
  try { r = stringify_toJSON_date(({ d: new Date(0), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-date " + typeof r + " " + String(r))
}
run_toJSON_date(); run_toJSON_date(); run_toJSON_date()
}
{

function stringify_toJSON_date_invalid(v) { return JSON.stringify(v) }
function run_toJSON_date_invalid() {
  let r
  try { r = stringify_toJSON_date_invalid(({ d: new Date(NaN), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-date-invalid " + typeof r + " " + String(r))
}
run_toJSON_date_invalid(); run_toJSON_date_invalid(); run_toJSON_date_invalid()
}
{
class A { d = new Date(86400000); x = 1 }
function stringify_toJSON_date_field(v) { return JSON.stringify(v) }
function run_toJSON_date_field() {
  let r
  try { r = stringify_toJSON_date_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-date-field " + typeof r + " " + String(r))
}
run_toJSON_date_field(); run_toJSON_date_field(); run_toJSON_date_field()
}
{
function make() { const d = new Date(0); d.toJSON = () => "mine"; return d }
function stringify_toJSON_date_own(v) { return JSON.stringify(v) }
function run_toJSON_date_own() {
  let r
  try { r = stringify_toJSON_date_own(({ d: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-date-own " + typeof r + " " + String(r))
}
run_toJSON_date_own(); run_toJSON_date_own(); run_toJSON_date_own()
}
{
class B { toJSON() { throw new RangeError("no") } }
class A { x = 1; b = new B() }
function stringify_toJSON_throws(v) { return JSON.stringify(v) }
function run_toJSON_throws() {
  let r
  try { r = stringify_toJSON_throws(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-throws " + typeof r + " " + String(r))
}
run_toJSON_throws(); run_toJSON_throws(); run_toJSON_throws()
}
{
let calls = 0
class B { toJSON() { return ++calls } }
class A { b = new B(); c = new B() }
function stringify_toJSON_counts_calls(v) { return JSON.stringify(v) }
function run_toJSON_counts_calls() {
  let r
  try { r = stringify_toJSON_counts_calls(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("toJSON-counts-calls " + typeof r + " " + String(r))
}
run_toJSON_counts_calls(); run_toJSON_counts_calls(); run_toJSON_counts_calls()
}
{

function stringify_boxed_members(v) { return JSON.stringify(v) }
function run_boxed_members() {
  let r
  try { r = stringify_boxed_members(({ n: new Number(1.5), s: new String("s"), b: new Boolean(false) })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-members " + typeof r + " " + String(r))
}
run_boxed_members(); run_boxed_members(); run_boxed_members()
}
{
class A { n = new Number(3); s = new String("q\"q"); b = new Boolean(true) }
function stringify_boxed_fields(v) { return JSON.stringify(v) }
function run_boxed_fields() {
  let r
  try { r = stringify_boxed_fields(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-fields " + typeof r + " " + String(r))
}
run_boxed_fields(); run_boxed_fields(); run_boxed_fields()
}
{

function stringify_boxed_root_number(v) { return JSON.stringify(v) }
function run_boxed_root_number() {
  let r
  try { r = stringify_boxed_root_number(new Number(7)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-root-number " + typeof r + " " + String(r))
}
run_boxed_root_number(); run_boxed_root_number(); run_boxed_root_number()
}
{

function stringify_boxed_root_string(v) { return JSON.stringify(v) }
function run_boxed_root_string() {
  let r
  try { r = stringify_boxed_root_string(new String("r")) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-root-string " + typeof r + " " + String(r))
}
run_boxed_root_string(); run_boxed_root_string(); run_boxed_root_string()
}
{

function stringify_boxed_root_boolean(v) { return JSON.stringify(v) }
function run_boxed_root_boolean() {
  let r
  try { r = stringify_boxed_root_boolean(new Boolean(false)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-root-boolean " + typeof r + " " + String(r))
}
run_boxed_root_boolean(); run_boxed_root_boolean(); run_boxed_root_boolean()
}
{

function stringify_boxed_array(v) { return JSON.stringify(v) }
function run_boxed_array() {
  let r
  try { r = stringify_boxed_array([new Number(NaN), new String(""), new Boolean(true)]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-array " + typeof r + " " + String(r))
}
run_boxed_array(); run_boxed_array(); run_boxed_array()
}
{
function make() { const n = new Number(1); n.valueOf = () => 42; return n }
function stringify_boxed_number_valueOf(v) { return JSON.stringify(v) }
function run_boxed_number_valueOf() {
  let r
  try { r = stringify_boxed_number_valueOf(({ n: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-number-valueOf " + typeof r + " " + String(r))
}
run_boxed_number_valueOf(); run_boxed_number_valueOf(); run_boxed_number_valueOf()
}
{
function make() { const s = new String("a"); s.toString = () => "other"; return s }
function stringify_boxed_string_toString(v) { return JSON.stringify(v) }
function run_boxed_string_toString() {
  let r
  try { r = stringify_boxed_string_toString(({ s: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-string-toString " + typeof r + " " + String(r))
}
run_boxed_string_toString(); run_boxed_string_toString(); run_boxed_string_toString()
}
{
class N extends Number { extra = 1 }
function stringify_boxed_subclass(v) { return JSON.stringify(v) }
function run_boxed_subclass() {
  let r
  try { r = stringify_boxed_subclass(({ n: new N(5) })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boxed-subclass " + typeof r + " " + String(r))
}
run_boxed_subclass(); run_boxed_subclass(); run_boxed_subclass()
}
{
class A { a = NaN; b = Infinity; c = -Infinity; d = -0; e = 0 }
function stringify_number_special_fields(v) { return JSON.stringify(v) }
function run_number_special_fields() {
  let r
  try { r = stringify_number_special_fields(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-special-fields " + typeof r + " " + String(r))
}
run_number_special_fields(); run_number_special_fields(); run_number_special_fields()
}
{

function stringify_number_special_root_nan(v) { return JSON.stringify(v) }
function run_number_special_root_nan() {
  let r
  try { r = stringify_number_special_root_nan(NaN) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-special-root-nan " + typeof r + " " + String(r))
}
run_number_special_root_nan(); run_number_special_root_nan(); run_number_special_root_nan()
}
{

function stringify_number_special_root_negative_zero(v) { return JSON.stringify(v) }
function run_number_special_root_negative_zero() {
  let r
  try { r = stringify_number_special_root_negative_zero(-0) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-special-root-negative-zero " + typeof r + " " + String(r))
}
run_number_special_root_negative_zero(); run_number_special_root_negative_zero(); run_number_special_root_negative_zero()
}
{

function stringify_number_special_array(v) { return JSON.stringify(v) }
function run_number_special_array() {
  let r
  try { r = stringify_number_special_array([NaN, Infinity, -Infinity, -0, 0.5]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-special-array " + typeof r + " " + String(r))
}
run_number_special_array(); run_number_special_array(); run_number_special_array()
}
{
let n = 0
class A { constructor(k) { this.q = 1 / k; this.r = k / k; this.z = -k * 0 } }
function stringify_number_computed(v) { return JSON.stringify(v) }
function run_number_computed() {
  let r
  try { r = stringify_number_computed(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-computed " + typeof r + " " + String(r))
}
run_number_computed(); run_number_computed(); run_number_computed()
}
{

function stringify_number_forms(v) { return JSON.stringify(v) }
function run_number_forms() {
  let r
  try { r = stringify_number_forms(({ a: 1e21, b: 1e-7, c: 0.1, d: 9007199254740991, e: 2147483648, f: -2147483649, g: 123456789012345680000, h: 5e-324, i: 1.7976931348623157e308 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-forms " + typeof r + " " + String(r))
}
run_number_forms(); run_number_forms(); run_number_forms()
}
{

function stringify_number_int_array(v) { return JSON.stringify(v) }
function run_number_int_array() {
  let r
  try { r = stringify_number_int_array([0, -1, 2147483647, -2147483648]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-int-array " + typeof r + " " + String(r))
}
run_number_int_array(); run_number_int_array(); run_number_int_array()
}
{
let n = 0
class A { constructor(k) { this.v = k % 2 ? null : k; this.x = 1 } }
function stringify_number_or_null(v) { return JSON.stringify(v) }
function run_number_or_null() {
  let r
  try { r = stringify_number_or_null(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("number-or-null " + typeof r + " " + String(r))
}
run_number_or_null(); run_number_or_null(); run_number_or_null()
}
{

function stringify_string_escapes(v) { return JSON.stringify(v) }
function run_string_escapes() {
  let r
  try { r = stringify_string_escapes(({ s: "\"\\\b\f\n\r\t\u0000\u001f\u007f/\u2028\u2029" })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("string-escapes " + typeof r + " " + String(r))
}
run_string_escapes(); run_string_escapes(); run_string_escapes()
}
{

function stringify_string_surrogates(v) { return JSON.stringify(v) }
function run_string_surrogates() {
  let r
  try { r = stringify_string_surrogates(({ a: "\ud800", b: "\udc00x", c: "\ud83d\ude00", d: "\u00e9\u4e2d" })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("string-surrogates " + typeof r + " " + String(r))
}
run_string_surrogates(); run_string_surrogates(); run_string_surrogates()
}
{
class A { s = "a\"b"; t = ""; u = "\u4e2d" }
function stringify_string_field(v) { return JSON.stringify(v) }
function run_string_field() {
  let r
  try { r = stringify_string_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("string-field " + typeof r + " " + String(r))
}
run_string_field(); run_string_field(); run_string_field()
}
{

function stringify_key_escapes(v) { return JSON.stringify(v) }
function run_key_escapes() {
  let r
  try { r = stringify_key_escapes(({ "a\"b": 1, "": 2, "\n": 3, "\u4e2d": 4, "\ud800": 5 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("key-escapes " + typeof r + " " + String(r))
}
run_key_escapes(); run_key_escapes(); run_key_escapes()
}
{
class A { "a\"b" = 1; "" = 2; "\n" = 3; "\u4e2d" = 4 }
function stringify_key_escapes_fields(v) { return JSON.stringify(v) }
function run_key_escapes_fields() {
  let r
  try { r = stringify_key_escapes_fields(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("key-escapes-fields " + typeof r + " " + String(r))
}
run_key_escapes_fields(); run_key_escapes_fields(); run_key_escapes_fields()
}
{

function stringify_key_index_order(v) { return JSON.stringify(v) }
function run_key_index_order() {
  let r
  try { r = stringify_key_index_order(({ b: 1, 2: "two", a: 2, 1: "one", "-1": 3, "01": 4, 4294967295: 5 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("key-index-order " + typeof r + " " + String(r))
}
run_key_index_order(); run_key_index_order(); run_key_index_order()
}
{
class A { b = 1; 2 = "two"; a = 2; 1 = "one" }
function stringify_key_index_fields(v) { return JSON.stringify(v) }
function run_key_index_fields() {
  let r
  try { r = stringify_key_index_fields(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("key-index-fields " + typeof r + " " + String(r))
}
run_key_index_fields(); run_key_index_fields(); run_key_index_fields()
}
{

function stringify_key_proto_computed(v) { return JSON.stringify(v) }
function run_key_proto_computed() {
  let r
  try { r = stringify_key_proto_computed(({ ["__proto__"]: 1, x: 2 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("key-proto-computed " + typeof r + " " + String(r))
}
run_key_proto_computed(); run_key_proto_computed(); run_key_proto_computed()
}
{
class A { __proto__ = 1; x = 2 }
function stringify_key_proto_field(v) { return JSON.stringify(v) }
function run_key_proto_field() {
  let r
  try { r = stringify_key_proto_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("key-proto-field " + typeof r + " " + String(r))
}
run_key_proto_field(); run_key_proto_field(); run_key_proto_field()
}
{
let n = 0
class A { constructor(k) { if (k % 2) { this.a = 1; this.b = 2 } else { this.b = 2; this.a = 1 } } }
function stringify_key_order_by_branch(v) { return JSON.stringify(v) }
function run_key_order_by_branch() {
  let r
  try { r = stringify_key_order_by_branch(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("key-order-by-branch " + typeof r + " " + String(r))
}
run_key_order_by_branch(); run_key_order_by_branch(); run_key_order_by_branch()
}
{

function stringify_getter_literal(v) { return JSON.stringify(v) }
function run_getter_literal() {
  let r
  try { r = stringify_getter_literal(({ get g() { return 1 }, x: 2 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-literal " + typeof r + " " + String(r))
}
run_getter_literal(); run_getter_literal(); run_getter_literal()
}
{

function stringify_getter_literal_returns_function(v) { return JSON.stringify(v) }
function run_getter_literal_returns_function() {
  let r
  try { r = stringify_getter_literal_returns_function(({ get g() { return () => 1 }, x: 2 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-literal-returns-function " + typeof r + " " + String(r))
}
run_getter_literal_returns_function(); run_getter_literal_returns_function(); run_getter_literal_returns_function()
}
{
class A { x = 1; get g() { return 2 } }
function stringify_getter_on_prototype(v) { return JSON.stringify(v) }
function run_getter_on_prototype() {
  let r
  try { r = stringify_getter_on_prototype(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-on-prototype " + typeof r + " " + String(r))
}
run_getter_on_prototype(); run_getter_on_prototype(); run_getter_on_prototype()
}
{
class A { constructor() { this.x = 1; Object.defineProperty(this, "g", { get() { return "got" }, enumerable: true, configurable: true }); this.y = 2 } }
function stringify_getter_defined_on_instance(v) { return JSON.stringify(v) }
function run_getter_defined_on_instance() {
  let r
  try { r = stringify_getter_defined_on_instance(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-defined-on-instance " + typeof r + " " + String(r))
}
run_getter_defined_on_instance(); run_getter_defined_on_instance(); run_getter_defined_on_instance()
}
{
class A { x = 1; y = 2; constructor() { Object.defineProperty(this, "x", { get() { return () => 1 }, enumerable: true }) } }
function stringify_getter_replaces_field(v) { return JSON.stringify(v) }
function run_getter_replaces_field() {
  let r
  try { r = stringify_getter_replaces_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-replaces-field " + typeof r + " " + String(r))
}
run_getter_replaces_field(); run_getter_replaces_field(); run_getter_replaces_field()
}
{

function stringify_getter_throws(v) { return JSON.stringify(v) }
function run_getter_throws() {
  let r
  try { r = stringify_getter_throws(({ x: 1, get g() { throw new EvalError("g") } })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-throws " + typeof r + " " + String(r))
}
run_getter_throws(); run_getter_throws(); run_getter_throws()
}
{

function stringify_getter_deletes_later_key(v) { return JSON.stringify(v) }
function run_getter_deletes_later_key() {
  let r
  try { r = stringify_getter_deletes_later_key(({ get g() { delete this.z; this.added = 1; return 1 }, z: 2, w: 3 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-deletes-later-key " + typeof r + " " + String(r))
}
run_getter_deletes_later_key(); run_getter_deletes_later_key(); run_getter_deletes_later_key()
}
{
let reads = 0
function stringify_getter_counts_reads(v) { return JSON.stringify(v) }
function run_getter_counts_reads() {
  let r
  try { r = stringify_getter_counts_reads(({ get g() { return ++reads }, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("getter-counts-reads " + typeof r + " " + String(r))
}
run_getter_counts_reads(); run_getter_counts_reads(); run_getter_counts_reads()
}
{

function stringify_setter_only(v) { return JSON.stringify(v) }
function run_setter_only() {
  let r
  try { r = stringify_setter_only(({ set s(v) {}, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("setter-only " + typeof r + " " + String(r))
}
run_setter_only(); run_setter_only(); run_setter_only()
}
{
class A { constructor() { this.x = 1; Object.defineProperty(this, "h", { value: 1, enumerable: false }); this.y = 2 } }
function stringify_hidden_defined(v) { return JSON.stringify(v) }
function run_hidden_defined() {
  let r
  try { r = stringify_hidden_defined(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("hidden-defined " + typeof r + " " + String(r))
}
run_hidden_defined(); run_hidden_defined(); run_hidden_defined()
}
{
class A { x = 1; h = 2; constructor() { Object.defineProperty(this, "h", { enumerable: false }) } }
function stringify_hidden_redefined_field(v) { return JSON.stringify(v) }
function run_hidden_redefined_field() {
  let r
  try { r = stringify_hidden_redefined_field(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("hidden-redefined-field " + typeof r + " " + String(r))
}
run_hidden_redefined_field(); run_hidden_redefined_field(); run_hidden_redefined_field()
}
{
let n = 0
class A { x = 1; h = 2; constructor(k) { if (k % 2) Object.defineProperty(this, "h", { enumerable: false }) } }
function stringify_hidden_redefined_sometimes(v) { return JSON.stringify(v) }
function run_hidden_redefined_sometimes() {
  let r
  try { r = stringify_hidden_redefined_sometimes(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("hidden-redefined-sometimes " + typeof r + " " + String(r))
}
run_hidden_redefined_sometimes(); run_hidden_redefined_sometimes(); run_hidden_redefined_sometimes()
}
{
class A { #p = 1; x = 2; #m() {} static s = 3; get p() { return this.#p } }
function stringify_private_fields(v) { return JSON.stringify(v) }
function run_private_fields() {
  let r
  try { r = stringify_private_fields(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("private-fields " + typeof r + " " + String(r))
}
run_private_fields(); run_private_fields(); run_private_fields()
}
{
class A { #p = () => 1 }
function stringify_private_only(v) { return JSON.stringify(v) }
function run_private_only() {
  let r
  try { r = stringify_private_only(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("private-only " + typeof r + " " + String(r))
}
run_private_only(); run_private_only(); run_private_only()
}
{
let n = 0
class A { constructor(k) { this.v = k % 2 ? 7 : () => k; this.x = 1 } }
function stringify_union_function_or_number(v) { return JSON.stringify(v) }
function run_union_function_or_number() {
  let r
  try { r = stringify_union_function_or_number(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-function-or-number " + typeof r + " " + String(r))
}
run_union_function_or_number(); run_union_function_or_number(); run_union_function_or_number()
}
{
let n = 0
class A { constructor(k) { this.x = 1; this.v = k % 2 ? 7 : () => k } }
function stringify_union_function_or_number_last(v) { return JSON.stringify(v) }
function run_union_function_or_number_last() {
  let r
  try { r = stringify_union_function_or_number_last(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-function-or-number-last " + typeof r + " " + String(r))
}
run_union_function_or_number_last(); run_union_function_or_number_last(); run_union_function_or_number_last()
}
{
let n = 0
class A { constructor(k) { this.v = k % 2 ? 7 : () => k } }
function stringify_union_function_or_number_only(v) { return JSON.stringify(v) }
function run_union_function_or_number_only() {
  let r
  try { r = stringify_union_function_or_number_only(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-function-or-number-only " + typeof r + " " + String(r))
}
run_union_function_or_number_only(); run_union_function_or_number_only(); run_union_function_or_number_only()
}
{
let n = 0
class A { constructor(k) { this.v = k === 0 ? "s" : k === 1 ? undefined : () => k; this.x = 1 } }
function stringify_union_function_or_string_or_undefined(v) { return JSON.stringify(v) }
function run_union_function_or_string_or_undefined() {
  let r
  try { r = stringify_union_function_or_string_or_undefined(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-function-or-string-or-undefined " + typeof r + " " + String(r))
}
run_union_function_or_string_or_undefined(); run_union_function_or_string_or_undefined(); run_union_function_or_string_or_undefined()
}
{
let n = 0
class B { y = 1 }
class A { constructor(k) { this.v = k % 2 ? new B() : () => k; this.x = 1 } }
function stringify_union_function_or_object(v) { return JSON.stringify(v) }
function run_union_function_or_object() {
  let r
  try { r = stringify_union_function_or_object(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-function-or-object " + typeof r + " " + String(r))
}
run_union_function_or_object(); run_union_function_or_object(); run_union_function_or_object()
}
{
let n = 0
class A { constructor(k) { this.v = k % 2 ? [k] : () => k; this.x = 1 } }
function stringify_union_function_or_array(v) { return JSON.stringify(v) }
function run_union_function_or_array() {
  let r
  try { r = stringify_union_function_or_array(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-function-or-array " + typeof r + " " + String(r))
}
run_union_function_or_array(); run_union_function_or_array(); run_union_function_or_array()
}
{
let n = 0
class A { constructor(k) { this.v = k % 2 ? null : () => k; this.x = 1 } }
function stringify_union_function_or_null(v) { return JSON.stringify(v) }
function run_union_function_or_null() {
  let r
  try { r = stringify_union_function_or_null(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-function-or-null " + typeof r + " " + String(r))
}
run_union_function_or_null(); run_union_function_or_null(); run_union_function_or_null()
}
{
let n = 0
class A { v = 1; x = 1 }
function next() { const a = new A(); if (n++ % 2) a.v = () => 1; return a }
function stringify_union_assigned_later(v) { return JSON.stringify(v) }
function run_union_assigned_later() {
  let r
  try { r = stringify_union_assigned_later(next()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-assigned-later " + typeof r + " " + String(r))
}
run_union_assigned_later(); run_union_assigned_later(); run_union_assigned_later()
}
{
let n = 0
class A { f = () => 1; x = 1 }
class B { y = 2; g = () => 2 }
function stringify_union_two_layouts_root(v) { return JSON.stringify(v) }
function run_union_two_layouts_root() {
  let r
  try { r = stringify_union_two_layouts_root((n++ % 2 ? new A() : new B())) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-two-layouts-root " + typeof r + " " + String(r))
}
run_union_two_layouts_root(); run_union_two_layouts_root(); run_union_two_layouts_root()
}
{
let n = 0
class A { f = () => 1; x = 1 }
function stringify_union_layout_or_undefined_root(v) { return JSON.stringify(v) }
function run_union_layout_or_undefined_root() {
  let r
  try { r = stringify_union_layout_or_undefined_root((n++ % 2 ? new A() : undefined)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-layout-or-undefined-root " + typeof r + " " + String(r))
}
run_union_layout_or_undefined_root(); run_union_layout_or_undefined_root(); run_union_layout_or_undefined_root()
}
{
let n = 0
class A { f = () => 1; x = 1 }
function stringify_union_layout_or_null_root(v) { return JSON.stringify(v) }
function run_union_layout_or_null_root() {
  let r
  try { r = stringify_union_layout_or_null_root((n++ % 2 ? new A() : null)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-layout-or-null-root " + typeof r + " " + String(r))
}
run_union_layout_or_null_root(); run_union_layout_or_null_root(); run_union_layout_or_null_root()
}
{
let n = 0
function stringify_union_element_function_or_number(v) { return JSON.stringify(v) }
function run_union_element_function_or_number() {
  let r
  try { r = stringify_union_element_function_or_number([n++ % 2 ? 1 : () => 1, 2]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("union-element-function-or-number " + typeof r + " " + String(r))
}
run_union_element_function_or_number(); run_union_element_function_or_number(); run_union_element_function_or_number()
}
{
class B { b = 1; f = () => 1 }
class A extends B { a = 2; g = () => 2 }
function stringify_subclass_fields(v) { return JSON.stringify(v) }
function run_subclass_fields() {
  let r
  try { r = stringify_subclass_fields(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("subclass-fields " + typeof r + " " + String(r))
}
run_subclass_fields(); run_subclass_fields(); run_subclass_fields()
}
{
let n = 0
class B { b = 1; f = () => 1 }
class A extends B { a = 2 }
function stringify_subclass_and_base_one_site(v) { return JSON.stringify(v) }
function run_subclass_and_base_one_site() {
  let r
  try { r = stringify_subclass_and_base_one_site((n++ % 2 ? new A() : new B())) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("subclass-and-base-one-site " + typeof r + " " + String(r))
}
run_subclass_and_base_one_site(); run_subclass_and_base_one_site(); run_subclass_and_base_one_site()
}
{
class L extends Array { extra = 1 }
function make() { const l = new L(); l[0] = 1; l[1] = () => 1; return l }
function stringify_subclass_of_array(v) { return JSON.stringify(v) }
function run_subclass_of_array() {
  let r
  try { r = stringify_subclass_of_array(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("subclass-of-array " + typeof r + " " + String(r))
}
run_subclass_of_array(); run_subclass_of_array(); run_subclass_of_array()
}
{
class M extends Map { extra = 1; f = () => 1 }
function stringify_subclass_of_map(v) { return JSON.stringify(v) }
function run_subclass_of_map() {
  let r
  try { r = stringify_subclass_of_map(new M()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("subclass-of-map " + typeof r + " " + String(r))
}
run_subclass_of_map(); run_subclass_of_map(); run_subclass_of_map()
}
{
class E extends Error { code = 5; f = () => 1 }
function stringify_subclass_of_error(v) { return JSON.stringify(v) }
function run_subclass_of_error() {
  let r
  try { r = stringify_subclass_of_error(new E("m")) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("subclass-of-error " + typeof r + " " + String(r))
}
run_subclass_of_error(); run_subclass_of_error(); run_subclass_of_error()
}
{
function Base() { return { fromBase: 1, f: () => 1 } }
class A extends Base { a = 2 }
function stringify_subclass_of_function_returning_object(v) { return JSON.stringify(v) }
function run_subclass_of_function_returning_object() {
  let r
  try { r = stringify_subclass_of_function_returning_object(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("subclass-of-function-returning-object " + typeof r + " " + String(r))
}
run_subclass_of_function_returning_object(); run_subclass_of_function_returning_object(); run_subclass_of_function_returning_object()
}
{
class A { f = () => 1; x = 1 }
function stringify_replacer_function(v) { return JSON.stringify(v, (k, w) => typeof w === "function" ? "fn:" + k : w) }
function run_replacer_function() {
  let r
  try { r = stringify_replacer_function(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("replacer-function " + typeof r + " " + String(r))
}
run_replacer_function(); run_replacer_function(); run_replacer_function()
}
{
class A { f = () => 1; x = 1; y = 2 }
function stringify_replacer_function_drops(v) { return JSON.stringify(v, (k, w) => k === "x" ? undefined : w) }
function run_replacer_function_drops() {
  let r
  try { r = stringify_replacer_function_drops(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("replacer-function-drops " + typeof r + " " + String(r))
}
run_replacer_function_drops(); run_replacer_function_drops(); run_replacer_function_drops()
}
{
class A { x = 1 }
function stringify_replacer_function_root_undefined(v) { return JSON.stringify(v, () => undefined) }
function run_replacer_function_root_undefined() {
  let r
  try { r = stringify_replacer_function_root_undefined(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("replacer-function-root-undefined " + typeof r + " " + String(r))
}
run_replacer_function_root_undefined(); run_replacer_function_root_undefined(); run_replacer_function_root_undefined()
}
{
class A { f = () => 1; x = 1; y = 2 }
function stringify_replacer_array(v) { return JSON.stringify(v, ["y", "f"]) }
function run_replacer_array() {
  let r
  try { r = stringify_replacer_array(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("replacer-array " + typeof r + " " + String(r))
}
run_replacer_array(); run_replacer_array(); run_replacer_array()
}
{
class A { f = () => 1; x = 1 }
function stringify_replacer_null(v) { return JSON.stringify(v, null) }
function run_replacer_null() {
  let r
  try { r = stringify_replacer_null(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("replacer-null " + typeof r + " " + String(r))
}
run_replacer_null(); run_replacer_null(); run_replacer_null()
}
{
class A { f = () => 1; x = 1 }
function stringify_replacer_undefined_indent_undefined(v) { return JSON.stringify(v, undefined, undefined) }
function run_replacer_undefined_indent_undefined() {
  let r
  try { r = stringify_replacer_undefined_indent_undefined(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("replacer-undefined-indent-undefined " + typeof r + " " + String(r))
}
run_replacer_undefined_indent_undefined(); run_replacer_undefined_indent_undefined(); run_replacer_undefined_indent_undefined()
}
{
class A { f = () => 1; x = 1 }
function stringify_replacer_not_callable(v) { return JSON.stringify(v, 5, null) }
function run_replacer_not_callable() {
  let r
  try { r = stringify_replacer_not_callable(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("replacer-not-callable " + typeof r + " " + String(r))
}
run_replacer_not_callable(); run_replacer_not_callable(); run_replacer_not_callable()
}
{
class A { f = () => 1; x = 1; l = [() => 1, 2]; e = {}; g = [] }
function stringify_indent_number(v) { return JSON.stringify(v, null, 2) }
function run_indent_number() {
  let r
  try { r = stringify_indent_number(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("indent-number " + typeof r + " " + String(r))
}
run_indent_number(); run_indent_number(); run_indent_number()
}
{
class A { f = () => 1; x = 1; y = { z: 1 } }
function stringify_indent_string(v) { return JSON.stringify(v, null, "--") }
function run_indent_string() {
  let r
  try { r = stringify_indent_string(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("indent-string " + typeof r + " " + String(r))
}
run_indent_string(); run_indent_string(); run_indent_string()
}
{
class A { f = () => 1; x = 1 }
function stringify_indent_zero(v) { return JSON.stringify(v, null, 0) }
function run_indent_zero() {
  let r
  try { r = stringify_indent_zero(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("indent-zero " + typeof r + " " + String(r))
}
run_indent_zero(); run_indent_zero(); run_indent_zero()
}
{
class A { f = () => 1; x = 1 }
function stringify_indent_empty_string(v) { return JSON.stringify(v, null, "") }
function run_indent_empty_string() {
  let r
  try { r = stringify_indent_empty_string(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("indent-empty-string " + typeof r + " " + String(r))
}
run_indent_empty_string(); run_indent_empty_string(); run_indent_empty_string()
}
{
let n = 0
class A { f = () => 1; x = 1 }
function stringify_indent_unknown(v) { return JSON.stringify(v, null, n++) }
function run_indent_unknown() {
  let r
  try { r = stringify_indent_unknown(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("indent-unknown " + typeof r + " " + String(r))
}
run_indent_unknown(); run_indent_unknown(); run_indent_unknown()
}
{

function stringify_no_argument(v) { return JSON.stringify() }
function run_no_argument() {
  let r
  try { r = stringify_no_argument(0) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("no-argument " + typeof r + " " + String(r))
}
run_no_argument(); run_no_argument(); run_no_argument()
}
{
class A { x = 1; constructor() { this.me = this } }
function stringify_cycle_self(v) { return JSON.stringify(v) }
function run_cycle_self() {
  let r
  try { r = stringify_cycle_self(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("cycle-self " + typeof r + " " + String(r))
}
run_cycle_self(); run_cycle_self(); run_cycle_self()
}
{
class A { x = 1; constructor() { this.o = { back: this } } }
function stringify_cycle_through_literal(v) { return JSON.stringify(v) }
function run_cycle_through_literal() {
  let r
  try { r = stringify_cycle_through_literal(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("cycle-through-literal " + typeof r + " " + String(r))
}
run_cycle_through_literal(); run_cycle_through_literal(); run_cycle_through_literal()
}
{
class A { x = 1; constructor() { this.l = [this] } }
function stringify_cycle_through_array(v) { return JSON.stringify(v) }
function run_cycle_through_array() {
  let r
  try { r = stringify_cycle_through_array(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("cycle-through-array " + typeof r + " " + String(r))
}
run_cycle_through_array(); run_cycle_through_array(); run_cycle_through_array()
}
{
class A { f = () => 1; constructor() { this.me = this } }
function stringify_cycle_with_function_member(v) { return JSON.stringify(v) }
function run_cycle_with_function_member() {
  let r
  try { r = stringify_cycle_with_function_member(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("cycle-with-function-member " + typeof r + " " + String(r))
}
run_cycle_with_function_member(); run_cycle_with_function_member(); run_cycle_with_function_member()
}
{
class B { y = 1 }
class A { constructor() { const b = new B(); this.p = b; this.q = b } }
function stringify_shared_not_cyclic(v) { return JSON.stringify(v) }
function run_shared_not_cyclic() {
  let r
  try { r = stringify_shared_not_cyclic(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("shared-not-cyclic " + typeof r + " " + String(r))
}
run_shared_not_cyclic(); run_shared_not_cyclic(); run_shared_not_cyclic()
}
{
class N { constructor(next) { this.f = () => 1; this.next = next } }
function make() { let l = null; for (let i = 0; i < 3000; i++) l = new N(l); return l }
function stringify_deep_list(v) { return JSON.stringify(v).length }
function run_deep_list() {
  let r
  try { r = stringify_deep_list(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("deep-list " + typeof r + " " + String(r))
}
run_deep_list(); run_deep_list(); run_deep_list()
}
{

function stringify_proxy_member(v) { return JSON.stringify(v) }
function run_proxy_member() {
  let r
  try { r = stringify_proxy_member(({ p: new Proxy({ a: 1, f: () => 1 }, {}), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("proxy-member " + typeof r + " " + String(r))
}
run_proxy_member(); run_proxy_member(); run_proxy_member()
}
{

function stringify_proxy_root(v) { return JSON.stringify(v) }
function run_proxy_root() {
  let r
  try { r = stringify_proxy_root(new Proxy({ a: 1, f: () => 1 }, {})) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("proxy-root " + typeof r + " " + String(r))
}
run_proxy_root(); run_proxy_root(); run_proxy_root()
}
{

function stringify_proxy_of_function(v) { return JSON.stringify(v) }
function run_proxy_of_function() {
  let r
  try { r = stringify_proxy_of_function(({ p: new Proxy(() => 1, {}), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("proxy-of-function " + typeof r + " " + String(r))
}
run_proxy_of_function(); run_proxy_of_function(); run_proxy_of_function()
}
{

function stringify_proxy_of_array(v) { return JSON.stringify(v) }
function run_proxy_of_array() {
  let r
  try { r = stringify_proxy_of_array(({ p: new Proxy([1, () => 1], {}) })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("proxy-of-array " + typeof r + " " + String(r))
}
run_proxy_of_array(); run_proxy_of_array(); run_proxy_of_array()
}
{

function stringify_builtin_objects(v) { return JSON.stringify(v) }
function run_builtin_objects() {
  let r
  try { r = stringify_builtin_objects(({ m: new Map([[1, 2]]), s: new Set([1]), w: new WeakMap(), r: /x/g, e: new Error("m"), p: Promise.resolve(1) })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("builtin-objects " + typeof r + " " + String(r))
}
run_builtin_objects(); run_builtin_objects(); run_builtin_objects()
}
{

function stringify_typed_array(v) { return JSON.stringify(v) }
function run_typed_array() {
  let r
  try { r = stringify_typed_array(({ t: new Uint8Array([1, 2]), b: new ArrayBuffer(2) })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("typed-array " + typeof r + " " + String(r))
}
run_typed_array(); run_typed_array(); run_typed_array()
}
{
function args() { return arguments }
function stringify_arguments_object(v) { return JSON.stringify(v) }
function run_arguments_object() {
  let r
  try { r = stringify_arguments_object(({ a: args(1, () => 1, "s") })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("arguments-object " + typeof r + " " + String(r))
}
run_arguments_object(); run_arguments_object(); run_arguments_object()
}
{
class A { f = () => 1; x = 1; constructor() { Object.freeze(this) } }
function stringify_frozen(v) { return JSON.stringify(v) }
function run_frozen() {
  let r
  try { r = stringify_frozen(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("frozen " + typeof r + " " + String(r))
}
run_frozen(); run_frozen(); run_frozen()
}
{

function stringify_sealed_literal(v) { return JSON.stringify(v) }
function run_sealed_literal() {
  let r
  try { r = stringify_sealed_literal(Object.seal({ f: () => 1, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("sealed-literal " + typeof r + " " + String(r))
}
run_sealed_literal(); run_sealed_literal(); run_sealed_literal()
}
{
function make() { const o = Object.create(null); o.f = () => 1; o.x = 1; return o }
function stringify_null_prototype(v) { return JSON.stringify(v) }
function run_null_prototype() {
  let r
  try { r = stringify_null_prototype(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("null-prototype " + typeof r + " " + String(r))
}
run_null_prototype(); run_null_prototype(); run_null_prototype()
}
{
class A { x = 1; f = () => 1; y = 2 }
function make() { const a = new A(); delete a.x; return a }
function stringify_deleted_field(v) { return JSON.stringify(v) }
function run_deleted_field() {
  let r
  try { r = stringify_deleted_field(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("deleted-field " + typeof r + " " + String(r))
}
run_deleted_field(); run_deleted_field(); run_deleted_field()
}
{
class A { x = 1; f = () => 1; y = 2 }
function make() { const a = new A(); delete a.x; a.x = 3; return a }
function stringify_deleted_and_added_again(v) { return JSON.stringify(v) }
function run_deleted_and_added_again() {
  let r
  try { r = stringify_deleted_and_added_again(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("deleted-and-added-again " + typeof r + " " + String(r))
}
run_deleted_and_added_again(); run_deleted_and_added_again(); run_deleted_and_added_again()
}
{
class A { x = 1 }
function make() { const a = new A(); a.extra = () => 1; a.more = 2; return a }
function stringify_extra_property(v) { return JSON.stringify(v) }
function run_extra_property() {
  let r
  try { r = stringify_extra_property(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("extra-property " + typeof r + " " + String(r))
}
run_extra_property(); run_extra_property(); run_extra_property()
}
{
let n = 0
class A { x = 1 }
function make() { const a = new A(); if (n++ % 2) a["k" + n] = n; return a }
function stringify_extra_property_sometimes(v) { return JSON.stringify(v) }
function run_extra_property_sometimes() {
  let r
  try { r = stringify_extra_property_sometimes(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("extra-property-sometimes " + typeof r + " " + String(r))
}
run_extra_property_sometimes(); run_extra_property_sometimes(); run_extra_property_sometimes()
}
{
let n = 0
class A { x = 1; f = () => 1 }
const other = { toJSON() { return "other" } }
function make() { const a = new A(); if (n++ % 2) Object.setPrototypeOf(a, other); return a }
function stringify_prototype_changed(v) { return JSON.stringify(v) }
function run_prototype_changed() {
  let r
  try { r = stringify_prototype_changed(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("prototype-changed " + typeof r + " " + String(r))
}
run_prototype_changed(); run_prototype_changed(); run_prototype_changed()
}
{

function stringify_raw_json(v) { return JSON.stringify(v) }
function run_raw_json() {
  let r
  try { r = stringify_raw_json(({ r: JSON.rawJSON("1e1000"), x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("raw-json " + typeof r + " " + String(r))
}
run_raw_json(); run_raw_json(); run_raw_json()
}
{

function stringify_global_this_member(v) { return JSON.stringify(v) }
function run_global_this_member() {
  let r
  try { r = stringify_global_this_member(({ j: JSON, m: Math, x: 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("global-this-member " + typeof r + " " + String(r))
}
run_global_this_member(); run_global_this_member(); run_global_this_member()
}
{
class A { f = () => ({ g: () => 1, y: 2 }); x = 1 }
function stringify_result_of_member_call(v) { return JSON.stringify(v) }
function run_result_of_member_call() {
  let r
  try { r = stringify_result_of_member_call(new A().f()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("result-of-member-call " + typeof r + " " + String(r))
}
run_result_of_member_call(); run_result_of_member_call(); run_result_of_member_call()
}
{
class A {}
function stringify_empty_instance(v) { return JSON.stringify(v) }
function run_empty_instance() {
  let r
  try { r = stringify_empty_instance(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("empty-instance " + typeof r + " " + String(r))
}
run_empty_instance(); run_empty_instance(); run_empty_instance()
}
{

function stringify_empty_literal_and_array(v) { return JSON.stringify(v) }
function run_empty_literal_and_array() {
  let r
  try { r = stringify_empty_literal_and_array(({ o: {}, a: [] })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("empty-literal-and-array " + typeof r + " " + String(r))
}
run_empty_literal_and_array(); run_empty_literal_and_array(); run_empty_literal_and_array()
}
{
class A { t = true; f = false; n = null }
function stringify_boolean_and_null_fields(v) { return JSON.stringify(v) }
function run_boolean_and_null_fields() {
  let r
  try { r = stringify_boolean_and_null_fields(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("boolean-and-null-fields " + typeof r + " " + String(r))
}
run_boolean_and_null_fields(); run_boolean_and_null_fields(); run_boolean_and_null_fields()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { delete current.z; return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
function stringify_change_deletes_later_key(v) { return JSON.stringify(v) }
function run_change_deletes_later_key() {
  let r
  try { r = stringify_change_deletes_later_key(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-deletes-later-key " + typeof r + " " + String(r))
}
run_change_deletes_later_key(); run_change_deletes_later_key(); run_change_deletes_later_key()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { delete current.z; return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
A.prototype.z = "inherited"
function stringify_change_deletes_later_key_found_on_prototype(v) { return JSON.stringify(v) }
function run_change_deletes_later_key_found_on_prototype() {
  let r
  try { r = stringify_change_deletes_later_key_found_on_prototype(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-deletes-later-key-found-on-prototype " + typeof r + " " + String(r))
}
run_change_deletes_later_key_found_on_prototype(); run_change_deletes_later_key_found_on_prototype(); run_change_deletes_later_key_found_on_prototype()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { current.added = 1; return "b" } }
class A { x = 1; b = new B(); z = 3 }
function stringify_change_adds_key(v) { return JSON.stringify(v) }
function run_change_adds_key() {
  let r
  try { r = stringify_change_adds_key(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-adds-key " + typeof r + " " + String(r))
}
run_change_adds_key(); run_change_adds_key(); run_change_adds_key()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { current.z = () => 1; return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
function stringify_change_stores_function(v) { return JSON.stringify(v) }
function run_change_stores_function() {
  let r
  try { r = stringify_change_stores_function(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-stores-function " + typeof r + " " + String(r))
}
run_change_stores_function(); run_change_stores_function(); run_change_stores_function()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { current.z = "text"; current.w = 1.5; return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
function stringify_change_stores_other_type(v) { return JSON.stringify(v) }
function run_change_stores_other_type() {
  let r
  try { r = stringify_change_stores_other_type(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-stores-other-type " + typeof r + " " + String(r))
}
run_change_stores_other_type(); run_change_stores_other_type(); run_change_stores_other_type()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { current.f = 7; return "b" } }
class A { x = 1; b = new B(); f = () => 1; w = 4 }
function stringify_change_replaces_function_by_number(v) { return JSON.stringify(v) }
function run_change_replaces_function_by_number() {
  let r
  try { r = stringify_change_replaces_function_by_number(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-replaces-function-by-number " + typeof r + " " + String(r))
}
run_change_replaces_function_by_number(); run_change_replaces_function_by_number(); run_change_replaces_function_by_number()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { Object.defineProperty(current, "z", { enumerable: false }); return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
function stringify_change_hides_later_key(v) { return JSON.stringify(v) }
function run_change_hides_later_key() {
  let r
  try { r = stringify_change_hides_later_key(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-hides-later-key " + typeof r + " " + String(r))
}
run_change_hides_later_key(); run_change_hides_later_key(); run_change_hides_later_key()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { Object.defineProperty(current, "z", { get() { return "got" }, enumerable: true }); return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
function stringify_change_makes_later_key_a_getter(v) { return JSON.stringify(v) }
function run_change_makes_later_key_a_getter() {
  let r
  try { r = stringify_change_makes_later_key_a_getter(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-makes-later-key-a-getter " + typeof r + " " + String(r))
}
run_change_makes_later_key_a_getter(); run_change_makes_later_key_a_getter(); run_change_makes_later_key_a_getter()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { delete current.z; current.z = "again"; return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
function stringify_change_reorders_keys(v) { return JSON.stringify(v) }
function run_change_reorders_keys() {
  let r
  try { r = stringify_change_reorders_keys(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-reorders-keys " + typeof r + " " + String(r))
}
run_change_reorders_keys(); run_change_reorders_keys(); run_change_reorders_keys()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { delete current.z } }
class A { b = new B(); z = 3 }
function stringify_change_first_member_omitted_rest_deleted(v) { return JSON.stringify(v) }
function run_change_first_member_omitted_rest_deleted() {
  let r
  try { r = stringify_change_first_member_omitted_rest_deleted(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-first-member-omitted-rest-deleted " + typeof r + " " + String(r))
}
run_change_first_member_omitted_rest_deleted(); run_change_first_member_omitted_rest_deleted(); run_change_first_member_omitted_rest_deleted()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { current.extra = 1 } }
class A { b = new B(); f = () => 1 }
function stringify_change_first_member_omitted_rest_function(v) { return JSON.stringify(v) }
function run_change_first_member_omitted_rest_function() {
  let r
  try { r = stringify_change_first_member_omitted_rest_function(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-first-member-omitted-rest-function " + typeof r + " " + String(r))
}
run_change_first_member_omitted_rest_function(); run_change_first_member_omitted_rest_function(); run_change_first_member_omitted_rest_function()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { delete current.x; current.y = 1; return "b" } }
class A { x = 1; b = new B() }
function stringify_change_last_member(v) { return JSON.stringify(v) }
function run_change_last_member() {
  let r
  try { r = stringify_change_last_member(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-last-member " + typeof r + " " + String(r))
}
run_change_last_member(); run_change_last_member(); run_change_last_member()
}
{
let current
function make() { current = new A(); return current }
class B { toJSON() { Object.setPrototypeOf(current, { toJSON() { return "too late" }, z: "p" }); delete current.z; return "b" } }
class A { x = 1; b = new B(); z = 3; w = 4 }
function stringify_change_prototype(v) { return JSON.stringify(v) }
function run_change_prototype() {
  let r
  try { r = stringify_change_prototype(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-prototype " + typeof r + " " + String(r))
}
run_change_prototype(); run_change_prototype(); run_change_prototype()
}
{
let current
function make() { current = { x: 1, get g() { delete current.z; return () => 1 }, z: 3, w: 4 }; return current }
function stringify_change_by_getter_of_function_member(v) { return JSON.stringify(v) }
function run_change_by_getter_of_function_member() {
  let r
  try { r = stringify_change_by_getter_of_function_member(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-by-getter-of-function-member " + typeof r + " " + String(r))
}
run_change_by_getter_of_function_member(); run_change_by_getter_of_function_member(); run_change_by_getter_of_function_member()
}
{
let current
class B { toJSON() { delete current.z; return "b" } }
class C { p = 1; b = new B(); q = 2 }
class A { x = 1; c = new C(); z = 3; w = 4 }
function make() { current = new A(); return current }
function stringify_change_in_nested_holder(v) { return JSON.stringify(v) }
function run_change_in_nested_holder() {
  let r
  try { r = stringify_change_in_nested_holder(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-in-nested-holder " + typeof r + " " + String(r))
}
run_change_in_nested_holder(); run_change_in_nested_holder(); run_change_in_nested_holder()
}
{
let list
class B { toJSON() { list[list.length] = "more"; return "b" } }
function make() { list = [new B(), 1, 2]; return list }
function stringify_change_array_grows(v) { return JSON.stringify(v) }
function run_change_array_grows() {
  let r
  try { r = stringify_change_array_grows(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-array-grows " + typeof r + " " + String(r))
}
run_change_array_grows(); run_change_array_grows(); run_change_array_grows()
}
{
let list
class B { toJSON() { list.length = 1; return "b" } }
function make() { list = [new B(), 1, 2]; return list }
function stringify_change_array_shrinks(v) { return JSON.stringify(v) }
function run_change_array_shrinks() {
  let r
  try { r = stringify_change_array_shrinks(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-array-shrinks " + typeof r + " " + String(r))
}
run_change_array_shrinks(); run_change_array_shrinks(); run_change_array_shrinks()
}
{
let list
class B { toJSON() { list[1] = () => 1; list[2] = 2.5; return "b" } }
function make() { list = [new B(), 1, 2]; return list }
function stringify_change_array_element_becomes_function(v) { return JSON.stringify(v) }
function run_change_array_element_becomes_function() {
  let r
  try { r = stringify_change_array_element_becomes_function(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-array-element-becomes-function " + typeof r + " " + String(r))
}
run_change_array_element_becomes_function(); run_change_array_element_becomes_function(); run_change_array_element_becomes_function()
}
{
let list
class B { toJSON() { delete list[1]; return "b" } }
function make() { list = [new B(), 1, 2]; return list }
function stringify_change_array_gets_hole(v) { return JSON.stringify(v) }
function run_change_array_gets_hole() {
  let r
  try { r = stringify_change_array_gets_hole(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-array-gets-hole " + typeof r + " " + String(r))
}
run_change_array_gets_hole(); run_change_array_gets_hole(); run_change_array_gets_hole()
}
{
let list
class B { toJSON() { list.toJSON = () => "too late"; return "b" } }
function make() { list = [new B(), 1, 2]; return list }
function stringify_change_array_gets_toJSON(v) { return JSON.stringify(v) }
function run_change_array_gets_toJSON() {
  let r
  try { r = stringify_change_array_gets_toJSON(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-array-gets-toJSON " + typeof r + " " + String(r))
}
run_change_array_gets_toJSON(); run_change_array_gets_toJSON(); run_change_array_gets_toJSON()
}
{
let list
class B { toJSON() { Object.defineProperty(list, 1, { get() { return "got" }, enumerable: true }); return "b" } }
function make() { list = [new B(), 1, 2]; return list }
function stringify_change_array_gets_index_getter(v) { return JSON.stringify(v) }
function run_change_array_gets_index_getter() {
  let r
  try { r = stringify_change_array_gets_index_getter(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("change-array-gets-index-getter " + typeof r + " " + String(r))
}
run_change_array_gets_index_getter(); run_change_array_gets_index_getter(); run_change_array_gets_index_getter()
}
{
let calls = 0
class B { toJSON() { return ++calls } }
class C { y = 1 }
class A { b = new B(); c = new C(); d = new B() }
function make() { const a = new A(); a.c.extra = 1; return a }
function stringify_once_nested_has_extra_property(v) { return JSON.stringify(v) }
function run_once_nested_has_extra_property() {
  let r
  try { r = stringify_once_nested_has_extra_property(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("once-nested-has-extra-property " + typeof r + " " + String(r))
}
run_once_nested_has_extra_property(); run_once_nested_has_extra_property(); run_once_nested_has_extra_property()
}
{
let calls = 0
class B { toJSON() { return ++calls } }
class C { y = 1; b = new B(); z = 2 }
class A { b = new B(); c = new C(); d = new B() }
function make() { const a = new A(); delete a.c.y; return a }
function stringify_once_nested_lost_a_field(v) { return JSON.stringify(v) }
function run_once_nested_lost_a_field() {
  let r
  try { r = stringify_once_nested_lost_a_field(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("once-nested-lost-a-field " + typeof r + " " + String(r))
}
run_once_nested_lost_a_field(); run_once_nested_lost_a_field(); run_once_nested_lost_a_field()
}
{
let calls = 0
class B { toJSON() { return ++calls } }
class A { b = new B(); d = new B() }
function make() { const a = new A(); a.extra = new B(); return a }
function stringify_once_root_has_extra_property(v) { return JSON.stringify(v) }
function run_once_root_has_extra_property() {
  let r
  try { r = stringify_once_root_has_extra_property(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("once-root-has-extra-property " + typeof r + " " + String(r))
}
run_once_root_has_extra_property(); run_once_root_has_extra_property(); run_once_root_has_extra_property()
}
{
let reads = 0
function make() { const o = { get g() { return ++reads }, me: null }; o.me = o; return o }
function stringify_once_getter_before_cycle(v) { return (() => { try { return JSON.stringify(v) } catch (e) { return e.name + " after " + reads + " reads" } })() }
function run_once_getter_before_cycle() {
  let r
  try { r = stringify_once_getter_before_cycle(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("once-getter-before-cycle " + typeof r + " " + String(r))
}
run_once_getter_before_cycle(); run_once_getter_before_cycle(); run_once_getter_before_cycle()
}
{
let calls = 0
class B { toJSON() { return ++calls } }
class A { b = new B(); n = 1n }
function stringify_once_toJSON_before_bigint(v) { return (() => { try { return JSON.stringify(v) } catch (e) { return e.name + " after " + calls + " calls" } })() }
function run_once_toJSON_before_bigint() {
  let r
  try { r = stringify_once_toJSON_before_bigint(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("once-toJSON-before-bigint " + typeof r + " " + String(r))
}
run_once_toJSON_before_bigint(); run_once_toJSON_before_bigint(); run_once_toJSON_before_bigint()
}
{
class A { m0 = () => 0; m1 = 1; m2 = "s2"; m3 = () => 3; m4 = 4; m5 = "s5"; m6 = () => 6; m7 = 7; m8 = "s8"; m9 = () => 9; m10 = 10; m11 = "s11"; m12 = () => 12; m13 = 13; m14 = "s14"; m15 = () => 15; m16 = 16; m17 = "s17"; m18 = () => 18; m19 = 19; m20 = "s20"; m21 = () => 21; m22 = 22; m23 = "s23"; m24 = () => 24; m25 = 25; m26 = "s26"; m27 = () => 27; m28 = 28; m29 = "s29"; m30 = () => 30; m31 = 31; m32 = "s32"; m33 = () => 33; m34 = 34; m35 = "s35"; m36 = () => 36; m37 = 37; m38 = "s38"; m39 = () => 39; m40 = 40; m41 = "s41"; m42 = () => 42; m43 = 43; m44 = "s44"; m45 = () => 45; m46 = 46; m47 = "s47"; m48 = () => 48; m49 = 49; m50 = "s50"; m51 = () => 51; m52 = 52; m53 = "s53"; m54 = () => 54; m55 = 55; m56 = "s56"; m57 = () => 57; m58 = 58; m59 = "s59"; m60 = () => 60; m61 = 61; m62 = "s62"; m63 = () => 63; m64 = 64; m65 = "s65"; m66 = () => 66; m67 = 67; m68 = "s68"; m69 = () => 69; }
function stringify_size_many_members(v) { return JSON.stringify(v) }
function run_size_many_members() {
  let r
  try { r = stringify_size_many_members(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("size-many-members " + typeof r + " " + String(r))
}
run_size_many_members(); run_size_many_members(); run_size_many_members()
}
{
class A { kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk = 1; f = () => 1; qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq = "v" }
function stringify_size_long_key(v) { return JSON.stringify(v) }
function run_size_long_key() {
  let r
  try { r = stringify_size_long_key(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("size-long-key " + typeof r + " " + String(r))
}
run_size_long_key(); run_size_long_key(); run_size_long_key()
}
{
function text(n) { let s = ""; for (let i = 0; i < n; i++) s += i % 7 ? "a" : "\"\n"; return s }
class A { constructor() { this.s = text(5000); this.f = () => 1; this.t = text(3) } }
function stringify_size_long_string(v) { return JSON.stringify(v) }
function run_size_long_string() {
  let r
  try { r = stringify_size_long_string(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("size-long-string " + typeof r + " " + String(r))
}
run_size_long_string(); run_size_long_string(); run_size_long_string()
}
{
function text(n) { let s = ""; for (let i = 0; i < n; i++) s += i % 7 ? "\u4e2d" : "\ud800"; return s }
class A { constructor() { this.s = text(700); this.f = () => 1 } }
function stringify_size_long_wide_string(v) { return JSON.stringify(v) }
function run_size_long_wide_string() {
  let r
  try { r = stringify_size_long_wide_string(new A()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("size-long-wide-string " + typeof r + " " + String(r))
}
run_size_long_wide_string(); run_size_long_wide_string(); run_size_long_wide_string()
}
{
function make() { const l = []; for (let i = 0; i < 3000; i++) l[i] = i % 5 ? i : () => i; return l }
function stringify_size_long_array(v) { return JSON.stringify(v).length }
function run_size_long_array() {
  let r
  try { r = stringify_size_long_array(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("size-long-array " + typeof r + " " + String(r))
}
run_size_long_array(); run_size_long_array(); run_size_long_array()
}
{
let n = 0
class A { constructor(k) { this.rope = "left" + k + "right"; this.sub = "0123456789abcdef".substring(k, 9); this.one = "xyz"[k]; this.num = String(k * 1.5) } }
function stringify_size_string_kinds(v) { return JSON.stringify(v) }
function run_size_string_kinds() {
  let r
  try { r = stringify_size_string_kinds(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("size-string-kinds " + typeof r + " " + String(r))
}
run_size_string_kinds(); run_size_string_kinds(); run_size_string_kinds()
}
{

function stringify_date_extreme_years(v) { return JSON.stringify(v) }
function run_date_extreme_years() {
  let r
  try { r = stringify_date_extreme_years([new Date(8.64e15), new Date(-8.64e15), new Date(253402300800000), new Date(-62198755200000), new Date(-1), new Date(0.9)]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-extreme-years " + typeof r + " " + String(r))
}
run_date_extreme_years(); run_date_extreme_years(); run_date_extreme_years()
}
{
let n = 0
class A { constructor(k) { this.d = new Date(k * 1e12); this.e = k % 2 ? null : new Date(NaN) } }
function stringify_date_fields(v) { return JSON.stringify(v) }
function run_date_fields() {
  let r
  try { r = stringify_date_fields(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-fields " + typeof r + " " + String(r))
}
run_date_fields(); run_date_fields(); run_date_fields()
}
{
class D extends Date { toISOString() { return "mine" } }
function stringify_date_subclass(v) { return JSON.stringify(v) }
function run_date_subclass() {
  let r
  try { r = stringify_date_subclass(({ d: new D(0) })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-subclass " + typeof r + " " + String(r))
}
run_date_subclass(); run_date_subclass(); run_date_subclass()
}
{
function make() { const d = new Date(0); d.toISOString = () => "own"; return d }
function stringify_date_own_toISOString(v) { return JSON.stringify(v) }
function run_date_own_toISOString() {
  let r
  try { r = stringify_date_own_toISOString(({ d: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-own-toISOString " + typeof r + " " + String(r))
}
run_date_own_toISOString(); run_date_own_toISOString(); run_date_own_toISOString()
}
{
function make() { const d = new Date(0); d.valueOf = () => NaN; return d }
function stringify_date_own_valueOf(v) { return JSON.stringify(v) }
function run_date_own_valueOf() {
  let r
  try { r = stringify_date_own_valueOf(({ d: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-own-valueOf " + typeof r + " " + String(r))
}
run_date_own_valueOf(); run_date_own_valueOf(); run_date_own_valueOf()
}
{
function make() { const d = new Date(0); d[Symbol.toPrimitive] = () => Infinity; return d }
function stringify_date_own_toPrimitive(v) { return JSON.stringify(v) }
function run_date_own_toPrimitive() {
  let r
  try { r = stringify_date_own_toPrimitive(({ d: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-own-toPrimitive " + typeof r + " " + String(r))
}
run_date_own_toPrimitive(); run_date_own_toPrimitive(); run_date_own_toPrimitive()
}
{

function stringify_date_root(v) { return JSON.stringify(v) }
function run_date_root() {
  let r
  try { r = stringify_date_root(new Date(1e12)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-root " + typeof r + " " + String(r))
}
run_date_root(); run_date_root(); run_date_root()
}
{
let n = 0
class A { constructor(k) { this.d = k % 2 ? new Date(0) : () => 1; this.x = 1 } }
function stringify_date_or_function(v) { return JSON.stringify(v) }
function run_date_or_function() {
  let r
  try { r = stringify_date_or_function(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("date-or-function " + typeof r + " " + String(r))
}
run_date_or_function(); run_date_or_function(); run_date_or_function()
}
{

function stringify_array_doubles(v) { return JSON.stringify(v) }
function run_array_doubles() {
  let r
  try { r = stringify_array_doubles([0.5, -0, NaN, 1e300, -1.5]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-doubles " + typeof r + " " + String(r))
}
run_array_doubles(); run_array_doubles(); run_array_doubles()
}
{

function stringify_array_doubles_holes(v) { return JSON.stringify(v) }
function run_array_doubles_holes() {
  let r
  try { r = stringify_array_doubles_holes([0.5, , 1.5]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-doubles-holes " + typeof r + " " + String(r))
}
run_array_doubles_holes(); run_array_doubles_holes(); run_array_doubles_holes()
}
{
function make() { const l = [1, 2]; l.toJSON = () => "list"; return l }
function stringify_array_own_toJSON(v) { return JSON.stringify(v) }
function run_array_own_toJSON() {
  let r
  try { r = stringify_array_own_toJSON(({ l: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-own-toJSON " + typeof r + " " + String(r))
}
run_array_own_toJSON(); run_array_own_toJSON(); run_array_own_toJSON()
}
{
function make() { const l = [1, 2]; l.name = "ignored"; l.f = () => 1; return l }
function stringify_array_named_property(v) { return JSON.stringify(v) }
function run_array_named_property() {
  let r
  try { r = stringify_array_named_property(({ l: make() })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-named-property " + typeof r + " " + String(r))
}
run_array_named_property(); run_array_named_property(); run_array_named_property()
}
{
function make() { const l = [1]; l[12] = () => 1; l[14] = 2; return l }
function stringify_array_far_index(v) { return JSON.stringify(v) }
function run_array_far_index() {
  let r
  try { r = stringify_array_far_index(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-far-index " + typeof r + " " + String(r))
}
run_array_far_index(); run_array_far_index(); run_array_far_index()
}
{

function stringify_array_frozen(v) { return JSON.stringify(v) }
function run_array_frozen() {
  let r
  try { r = stringify_array_frozen(Object.freeze([1, () => 1, "s"])) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-frozen " + typeof r + " " + String(r))
}
run_array_frozen(); run_array_frozen(); run_array_frozen()
}
{
function make() { const l = [1, 2, 3]; Object.defineProperty(l, 1, { get() { return () => 1 }, enumerable: true }); return l }
function stringify_array_index_getter(v) { return JSON.stringify(v) }
function run_array_index_getter() {
  let r
  try { r = stringify_array_index_getter(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-index-getter " + typeof r + " " + String(r))
}
run_array_index_getter(); run_array_index_getter(); run_array_index_getter()
}
{
class B { f = () => 1; y = 2 }
function stringify_array_of_arrays_of_instances(v) { return JSON.stringify(v) }
function run_array_of_arrays_of_instances() {
  let r
  try { r = stringify_array_of_arrays_of_instances([[new B()], [], [new B(), null, undefined]]) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-of-arrays-of-instances " + typeof r + " " + String(r))
}
run_array_of_arrays_of_instances(); run_array_of_arrays_of_instances(); run_array_of_arrays_of_instances()
}
{
let n = 0
class A { constructor(k) { this.l = [k, "s", null, k % 2 ? () => 1 : true, undefined, { z: () => 1 }] } }
function stringify_array_field_of_unions(v) { return JSON.stringify(v) }
function run_array_field_of_unions() {
  let r
  try { r = stringify_array_field_of_unions(new A(n++)) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-field-of-unions " + typeof r + " " + String(r))
}
run_array_field_of_unions(); run_array_field_of_unions(); run_array_field_of_unions()
}
{
function make() { const l = []; l.length = 3; return l }
function stringify_array_length_only(v) { return JSON.stringify(v) }
function run_array_length_only() {
  let r
  try { r = stringify_array_length_only(make()) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-length-only " + typeof r + " " + String(r))
}
run_array_length_only(); run_array_length_only(); run_array_length_only()
}
{

function stringify_array_like_object(v) { return JSON.stringify(v) }
function run_array_like_object() {
  let r
  try { r = stringify_array_like_object(({ length: 2, 0: "a", 1: () => 1 })) } catch (e) { r = "threw " + e.name + ": " + e.message }
  console.log("array-like-object " + typeof r + " " + String(r))
}
run_array_like_object(); run_array_like_object(); run_array_like_object()
}
