// RUN: lower
// OPTIONS: builtin-modules

// Members of writable stream by every copy and walk.
console.log("a spread", Object.values({ ...WritableStream }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("a spread between other members", Object.values({ first: 1, ...WritableStream, last: () => 2 }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("a spread of a spread", Object.values({ ...{ ...WritableStream } }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("a rest pattern", (({ ...rest }) => Object.values(rest))(WritableStream).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("assign onto a literal", Object.values(Object.assign({}, WritableStream)).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("assign onto an instance", Object.values(Object.assign(new (class Holder {})(), WritableStream)).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("assign onto an object without a prototype", Object.values(Object.assign(Object.create(null), WritableStream)).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("entries of a spread", Object.entries({ ...WritableStream }).map(([, value]) => value).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("keys of a spread", (copy => Object.keys(copy).map(key => copy[key]))({ ...WritableStream }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("own keys of a spread", (copy => Reflect.ownKeys(copy).map(key => copy[key]))({ ...WritableStream }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("values", Object.values(WritableStream).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("entries", Object.entries(WritableStream).map(([, value]) => value).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("keys", Object.keys(WritableStream).map(key => WritableStream[key]).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("own keys", Reflect.ownKeys(WritableStream).filter(key => key !== "caller" && key !== "arguments").map(key => WritableStream[key]).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("from entries", Object.values(Object.fromEntries(Object.entries(WritableStream))).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("descriptors", Object.values(Object.getOwnPropertyDescriptors(WritableStream)).filter(descriptor => descriptor.enumerable).map(descriptor => descriptor.value).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("define from descriptors", Object.values(Object.defineProperties({}, Object.getOwnPropertyDescriptors(WritableStream))).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
console.log("descriptors of a spread", Object.values(Object.getOwnPropertyDescriptors({ ...WritableStream })).map(descriptor => descriptor.value).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
try {
  console.log("a spread that holds the members themselves", Object.entries({ ...WritableStream }).map(([key, value]) => key + " " + (value === WritableStream[key])).join());
} catch (error) {
  console.log("a spread that holds the members themselves threw", error.name);
}
try {
  console.log("an instance that holds the members themselves", Object.entries(Object.assign(new (class Holder {})(), WritableStream)).map(([key, value]) => key + " " + (value === WritableStream[key])).join());
} catch (error) {
  console.log("an instance that holds the members themselves threw", error.name);
}
{
  const walked = WritableStream;
  const found = [];
  for (const key in walked) found.push(walked[key]);
console.log("for in", found.map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
}
{
  const walked = { ...WritableStream };
  const found = [];
  for (const key in walked) found.push(walked[key]);
console.log("for in over a spread", found.map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());
}
try {
  console.log("assign onto a frozen object", Object.values(Object.assign(Object.freeze({}), WritableStream)).length);
} catch (error) {
  console.log("assign onto a frozen object threw", error.name);
}
try {
  console.log("a clone of a spread", Object.keys(structuredClone({ ...WritableStream })).length);
} catch (error) {
  console.log("a clone of a spread threw", error.name);
}
try {
  console.log("a spread as JSON", JSON.stringify({ ...WritableStream }));
} catch (error) {
  console.log("a spread as JSON threw", error.name);
}
try {
  console.log("a replacer over a spread", JSON.stringify({ ...WritableStream }, (key, value) => (typeof value === "function" ? key : value === undefined ? "undefined" : value)).length);
} catch (error) {
  console.log("a replacer over a spread threw", error.name);
}

// GENERATED: last Holder
// CHECK-LABEL: function {{*}}name="last"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=2 flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=2 flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
