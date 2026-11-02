// RUN: lower
// OPTIONS: builtin-modules

// Everything is asked of a module namespace object.
import * as self from "./asked-module-namespace-object.mjs";
export var width = 30;
export let height = 40;
export function area() { return width * height; }
export const label = "box";
export default 7;

function tell(name, ask) {
  let text;
  try {
    const answer = ask();
    text = typeof answer === "string" ? answer : JSON.stringify(answer, (key, value) => (typeof value === "symbol" ? String(value) : typeof value === "function" ? "function " + value.name : value));
  } catch (error) {
    text = "throws " + error.name;
  }
  console.log(name + ": " + text);
}

for (let round = 0; round < 3; round++) {
  tell("by name", () => [self.width, self.height, self.label, self.default, self.area(), self.missing]);
  tell("by key", () => ["width", "label", "missing", Symbol.toStringTag].map(key => String(self[key])));
  tell("in", () => ["width" in self, "missing" in self, Symbol.toStringTag in self, Symbol.iterator in self]);
  tell("hasOwn", () => [Object.hasOwn(self, "width"), Object.hasOwn(self, "missing"), Object.hasOwn(self, Symbol.toStringTag)]);
  tell("hasOwnProperty", () => [Object.prototype.hasOwnProperty.call(self, "width"), Object.prototype.hasOwnProperty.call(self, "missing")]);
  tell("propertyIsEnumerable", () => [Object.prototype.propertyIsEnumerable.call(self, "width"), Object.prototype.propertyIsEnumerable.call(self, Symbol.toStringTag)]);
  tell("keys", () => Object.keys(self));
  tell("values", () => Object.values(self));
  tell("entries", () => Object.entries(self));
  tell("names", () => Object.getOwnPropertyNames(self));
  tell("symbols", () => Object.getOwnPropertySymbols(self).map(String));
  tell("ownKeys", () => Reflect.ownKeys(self).map(String));
  tell("ownKeys joined", () => Reflect.ownKeys(self).map(String).join());
  tell("descriptor", () => [Object.getOwnPropertyDescriptor(self, "width"), Object.getOwnPropertyDescriptor(self, Symbol.toStringTag), Object.getOwnPropertyDescriptor(self, "missing")]);
  tell("descriptors", () => Object.keys(Object.getOwnPropertyDescriptors(self)));
  tell("spread", () => ({ ...self }));
  tell("rest", () => { const { width: taken, ...rest } = self; return [taken, rest]; });
  tell("assign", () => Object.assign({}, self));
  tell("assign onto", () => Object.assign(self, {}) === self);
  tell("assign a name onto", () => Object.assign(self, { width: 1 }));
  tell("fromEntries", () => Object.fromEntries(Object.entries(self)));
  tell("stringify", () => JSON.stringify(self));
  tell("for in", () => { const seen = []; for (const key in self) seen.push(key, typeof self[key]); return seen; });
  tell("clone", () => structuredClone(self));
  tell("isFrozen", () => [Object.isFrozen(self), Object.isSealed(self), Object.isExtensible(self)]);
  tell("freeze", () => Object.freeze(self) === self);
  tell("seal", () => Object.seal(self) === self);
  tell("preventExtensions", () => Object.preventExtensions(self) === self);
  tell("isFrozen again", () => [Object.isFrozen(self), Object.isSealed(self), Object.isExtensible(self)]);
  tell("prototype", () => [Object.getPrototypeOf(self), Reflect.getPrototypeOf(self), self instanceof Object]);
  tell("setPrototypeOf null", () => Object.setPrototypeOf(self, null) === self);
  tell("setPrototypeOf", () => Object.setPrototypeOf(self, {}));
  tell("Reflect.setPrototypeOf", () => [Reflect.setPrototypeOf(self, null), Reflect.setPrototypeOf(self, {})]);
  tell("toString", () => Object.prototype.toString.call(self));
  tell("tag", () => self[Symbol.toStringTag]);
  tell("String", () => String(self));
  tell("template", () => `${self}`);
  tell("plus", () => self + "");
  const same = self;
  tell("store", () => { same.width = 1; return self.width; });
  tell("store a new name", () => { same.depth = 1; return self.depth; });
  tell("store by key", () => { same["hei" + "ght"] = 1; return self.height; });
  tell("delete", () => delete same.width);
  tell("delete a missing name", () => delete same.missing);
  tell("Reflect.set", () => [Reflect.set(self, "width", 1), Reflect.set(self, "depth", 1), self.width]);
  tell("Reflect.get", () => [Reflect.get(self, "width"), Reflect.get(self, "missing")]);
  tell("Reflect.has", () => [Reflect.has(self, "width"), Reflect.has(self, "missing")]);
  tell("Reflect.deleteProperty", () => [Reflect.deleteProperty(self, "width"), Reflect.deleteProperty(self, "missing")]);
  tell("Reflect.defineProperty", () => [Reflect.defineProperty(self, "width", { value: 30 }), Reflect.defineProperty(self, "width", { value: 31 }), Reflect.defineProperty(self, "depth", { value: 1 })]);
  tell("defineProperty", () => Object.defineProperty(self, "depth", { value: 1 }));
  tell("Reflect.isExtensible", () => [Reflect.isExtensible(self), Reflect.preventExtensions(self)]);
  tell("typeof", () => [typeof self, Array.isArray(self), self === self, Object.is(self, self), Object(self) === self]);
  tell("weak", () => { const map = new WeakMap([[self, 1]]); const set = new Set([self]); return [map.get(self), set.has(self)]; });
  tell("create", () => { const heir = Object.create(self); return [heir.width, "width" in heir, Object.keys(heir)]; });
  tell("array from", () => [Array.from(self), Array.prototype.slice.call(self), Array.prototype.map.call(self, String)]);
  tell("iterate", () => [...self]);
  tell("call", () => self());
  tell("construct", () => new self());
  tell("groupBy", () => Object.groupBy(Object.keys(self), key => typeof self[key]));
  width += 1;
  height += 1;
}

// GENERATED: area tell
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="height"
// CHECK-NEXT: v4 = Mul v1, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b10():
// CHECK-NEXT: v4 = Call v1 calleeName="ask"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v6 = TypeTest v5 testedType=string
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v7) handler=b10():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: Jump -> next b7(v7)
// CHECK-NEXT: b5(v8) handler=b10():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: v9 = Builtin builtin=JSON
// CHECK-NEXT: v10 = PropGet v9 key="stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v12 = NewClosure function=[[f_4]]
// CHECK-NEXT: v13 = Call v11, v9, v8, v12 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b7(v15) handler=b10():
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b11(v16)
// CHECK-NEXT: b10() role=CatchHandler:
// CHECK-NEXT: v17 = CatchValue
// CHECK-NEXT: v18 = String string="throws "
// CHECK-NEXT: v19 = PropGet v17 key="name"
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v21)
// CHECK-NEXT: b11(v22):
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = String string=": "
// CHECK-NEXT: v29 = Add v0, v28
// CHECK-NEXT: v30 = Add v29, v22
// CHECK-NEXT: v31 = Call v27, v25, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
