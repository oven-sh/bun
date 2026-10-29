// RUN: lower
// OPTIONS: builtin-modules

// The tag of a template only looks like a function.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function join(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += "[" + values[i] + "]" + strings[i + 1];
  return out;
}

function tagOnce(tag, value) {
  return tag`a${value}b${value + 1}c`;
}

function stringsOf(tag) {
  return tag`x${0}y`;
}

function rawOf(tag) {
  return tag`\n${0}A\x`;
}

const keep = strings => strings;

function honest(round) {
  console.log(round, tagOnce(join, 1), tagOnce(join, "v"), tagOnce((strings, a, b) => strings.length + a + b, 1), join`plain`, join`${1}`, join`${1}${2}`);
}

const tags = [
  ["a bound function", () => join.bind(null)],
  ["a function bound to an array of its own", () => join.bind(null, ["<", "|", "|", "|", ">"])],
  ["a callable proxy", () => new Proxy(join, { apply: (target, self, list) => (log.push("apply " + list.length + " " + typeof self), Reflect.apply(target, self, list)) })],
  ["String.raw", () => String.raw],
  ["Array.of", () => Array.of],
  ["an async function", () => async strings => strings.length],
  ["a generator function", () => function* (strings, a) { yield strings[0] + a; }],
  ["a class", () => class {}],
  ["an object with call", () => ({ call: join })],
  ["a string", () => "join"],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of tags) attempt("the tag is " + name, () => tagOnce(make(), 1));
for (const [name, make] of tags) attempt("the tag is a member that holds " + name, () => { const holder = { tag: make() }; return holder.tag`a${1}b`; });

attempt("the strings are an array", () => [Array.isArray(stringsOf(keep)), stringsOf(keep).length, Object.isFrozen(stringsOf(keep)), Object.isFrozen(stringsOf(keep).raw)]);
attempt("one place hands over the same strings every time", () => stringsOf(keep) === stringsOf(keep));
attempt("two places with the same text do not", () => keep`x${0}y` === keep`x${0}y`);
attempt("whatever the tag is", () => stringsOf(keep) === stringsOf(keep.bind(null)));
attempt("a push to the strings", () => stringsOf(keep).push("z"));
attempt("a store to the strings", () => { stringsOf(keep)[0] = "changed"; return stringsOf(keep)[0]; });
attempt("a store to their length", () => { stringsOf(keep).length = 0; return stringsOf(keep).length; });
attempt("sorting the strings", () => stringsOf(keep).sort());
attempt("mapping the strings", () => stringsOf(keep).map(text => text + "!"));
attempt("an escape that is not valid", () => [rawOf(keep)[0], rawOf(keep)[1], rawOf(keep).raw[0], rawOf(keep).raw[1]]);
attempt("raw is not enumerable", () => [Object.keys(stringsOf(keep)), JSON.stringify(Object.getOwnPropertyDescriptor(stringsOf(keep), "raw").enumerable)]);

attempt("this of a plain tag", () => (function () { return typeof this; })`x`);
attempt("this of a member tag", () => ({ name: "holder", tag() { return this.name; } }).tag`x`);
attempt("this of a tag read by a computed name", () => ({ name: "holder", tag() { return this.name; } })["t" + "ag"]`x`);
attempt("a tag that answers a tag", () => (() => join)`first``second${1}`);
attempt("new on the result of a tag", () => typeof new (() => function () {})`x`());
attempt("the values are evaluated in order before the call", () => ((...list) => (log.push("called"), list.length))`${log.push("first")}${log.push("second")}`);
attempt("and before a tag that is not callable throws", () => (void 0)`${log.push("first")}${log.push("second")}`);
attempt("the tag is read before the values", () => ({ get tag() { log.push("get tag"); return join; } }).tag`${log.push("value")}`);
attempt("values that are not strings are handed over as they are", () => ((strings, ...values) => values.map(value => typeof value))`${1}${"s"}${null}${undefined}${{}}${1n}${Symbol.iterator}`);
attempt("without a tag they are converted", () => `${1}${"s"}${null}${undefined}${{}}${1n}`);
attempt("without a tag a symbol throws", () => `${Symbol.iterator}`);
for (let i = 0; i < 2000; i++) tagOnce(join, i);
for (const [name, make] of tags) attempt("after 2000 honest tags, the tag is " + name, () => tagOnce(make(), 1));
honest("after");

// GENERATED: join stringsOf apply
// CHECK-LABEL: function {{*}}name="join"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = ElemGet v0, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v3, v5)
// CHECK-NEXT: b2(v6, v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = PropGet v1 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Less v7, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = String string="["
// CHECK-NEXT: v14 = ElemGet v1, v12
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = String string="]"
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = Integer integer=1
// CHECK-NEXT: v19 = Add v12, v18
// CHECK-NEXT: v20 = ElemGet v0, v19
// CHECK-NEXT: v21 = Add v17, v20
// CHECK-NEXT: v22 = Add v6, v21
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = Increment v12
// CHECK-NEXT: v24 = Convert v23 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v22, v24)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stringsOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewTemplateObject templateStrings=[{cooked="x" raw="x"}, {cooked="y" raw="y"}]
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Call v0, -, v1, v2 calleeName="tag"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=3 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[IsExpected]}, {type=anything}, {type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: anything, v2: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="apply "
// CHECK-NEXT: v8 = PropGet v2 key="length"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = TypeOf v1
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Call v6, v4, v14 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v16 = Builtin builtin=Reflect
// CHECK-NEXT: v17 = Builtin builtin=ReflectApply
// CHECK-NEXT: v18 = Call v17, v16, v0, v1, v2 calleeName="Reflect.apply"
// CHECK-NEXT: ReturnCall v18
// CHECK-NEXT: }
