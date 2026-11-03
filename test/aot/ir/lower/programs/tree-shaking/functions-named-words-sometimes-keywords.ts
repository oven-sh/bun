// RUN: lower
// OPTIONS: builtin-modules

// Words that mean something only in certain places are ordinary names elsewhere. Each is the name of a function here, and the one reference to it is a call, a shorthand property, a tag or an argument, in a place where a parser has to decide.
function async() { return "async"; } function of() { return "of"; } function get() { return "get"; } function set() { return "set"; }
function type() { return "type"; } function namespace() { return "namespace"; } function module() { return "module"; } function declare() { return "declare"; }
function abstract() { return "abstract"; } function as() { return "as"; } function from() { return "from"; } function satisfies() { return "satisfies"; }
function accessor() { return "accessor"; } function using() { return "using"; } function is() { return "is"; } function asserts() { return "asserts"; }
function keyof() { return "keyof"; } function readonly() { return "readonly"; } function infer() { return "infer"; } function unique() { return "unique"; }
function global() { return "global"; } function override() { return "override"; } function out() { return "out"; } function defer() { return "defer"; }
function target() { return "target"; } function meta() { return "meta"; } function constructor() { return "constructor"; } function require2() { return "require2"; }

const log: string[] = [];
log.push(async());
log.push(of(), get(), set());
log.push(type());
log.push(namespace());
log.push(module());
log.push(declare());
log.push(abstract());
log.push(as(), from(), satisfies(), accessor());
log.push(using());
log.push([is, asserts, keyof, readonly].map(each => each()).join());
log.push(Object.values({ infer, unique, global, override }).map(each => each()).join());
log.push((out as () => string)(), defer satisfies () => string ? defer() : "");
for (const each of [target]) log.push(each());
log.push(`${meta()}`, constructor(), require2());
console.log(log.join(" "));

// GENERATED: is
// CHECK-LABEL: function {{*}}name="is"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="is"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
