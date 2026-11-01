// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Class members whose names are array indices: setters, getters and methods, on the prototype and on the class, in typed and untyped code.
// @ts-ignore
import untyped from "./untyped-classes-with-index-named-members.js";
declare const console: any;
const said: string[] = [];
function block(name: string, body: () => void) { try { body(); } catch (error) { said.push(name + ": THROWS " + (error as Error).constructor.name); } }
function storeAt2(target: any, value: unknown) { target[2] = value; }
function readAt(target: any, index: number): unknown { return target[index]; }
const table = [storeAt2, readAt] as const;

class Typed1 { set 2(v: string) { said.push("Typed1's setter " + v); } get 3(): string { return "Typed1's getter"; } 4(): string { return "Typed1's method"; } }
block("typed", () => { const o = new Typed1(); o[2] = "a"; said.push("typed: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + o[3] + " | " + typeof o[4] + " | " + o[4]()); });

class Untyped1 { set 2(v: string) { said.push("Untyped1's setter " + v); } get 3(): string { return "Untyped1's getter"; } 4(): string { return "Untyped1's method"; } }
block("in untyped hands", () => { const o = new Untyped1(); table[0](o, "b"); said.push("in untyped hands: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + table[1](o, 3) + " | " + typeof table[1](o, 4)); });

class ReadFirst { get 0(): string { return "ReadFirst's getter"; } }
block("a read first", () => { said.push("a read first: " + table[1](new ReadFirst(), 0)); });

class InFirst { 7(): number { return 7; } }
block("`in` first", () => { said.push("`in` first: " + (7 in new InFirst()) + " " + (8 in new InFirst())); });

class ReflectFirst { set 5(v: string) { said.push("ReflectFirst's setter " + v); } }
block("Reflect.set first", () => { const o = new ReflectFirst(); said.push("Reflect.set first: " + Reflect.set(o, 5, "c") + " own 5: " + Object.prototype.hasOwnProperty.call(o, 5)); });

class Static1 { static 2(): string { return "Static1's method"; } static get 3(): string { return "Static1's getter"; } static set 4(v: string) { said.push("Static1's setter " + v); } }
block("static", () => { const c: any = Static1; said.push("static: " + typeof c[2] + " | " + c[3]); c[4] = "d"; said.push("static: own 4 is an accessor: " + (typeof Object.getOwnPropertyDescriptor(c, 4)!.set)); });

const two = 2, text = "3", big = 4n;
class Computed1 { [two](): string { return "[2]"; } [text](): string { return '["3"]'; } [big as any](): string { return "[4n]"; } }
block("computed", () => { const o: any = new Computed1(); said.push("computed: " + o[2]() + " " + o[3]() + " " + o[4]()); });

block("a literal", () => { const o: any = { 2() { return "a literal's method"; }, get 3() { return "a literal's getter"; }, set 4(v: string) { said.push("a literal's setter " + v); } }; o[4] = "e"; said.push("a literal: " + o[2]() + " | " + o[3]); });

class Base1 { 2(): string { return "Base1's 2"; } get 3(): string { return "Base1's 3"; } set 4(v: string) { said.push("Base1's setter " + v); } }
class Heir1 extends Base1 { viaSuper(): string { return super[2]() + " by super"; } named(): string { return "named"; } }
block("an heir without such members", () => { const o = new Heir1(); o[4] = "f"; said.push("an heir without such members: own 4: " + Object.prototype.hasOwnProperty.call(o, 4) + " | " + o[3] + " | " + o.viaSuper() + " | " + o.named()); });

class Base2 { named(): string { return "Base2's named"; } }
class Heir2 extends Base2 { get 1(): string { return "Heir2's 1"; } }
block("an heir with one", () => { said.push("an heir with one, of a base without: " + table[1](new Heir2(), 1) + " | " + new Heir2().named()); });

class ForArray { set 2(v: string) { said.push("ForArray's setter " + v); } }
block("an array given the prototype", () => { const o = Object.setPrototypeOf(["a", "b", , "d"], ForArray.prototype); table[0](o, "g"); said.push("an array given the prototype: own 2: " + Object.prototype.hasOwnProperty.call(o, 2)); });

class NoIndices { "4294967295"(): string { return "4294967295"; } "-1"(): string { return "-1"; } "1.5"(): string { return "1.5"; } "01"(): string { return "01"; } }
block("no indices", () => { const o: any = new NoIndices(); said.push("names that look like numbers and are no indices: " + o[4294967295]() + " " + o[-1]() + " " + o[1.5]() + " " + o["01"]() + " " + typeof o[1]); });

class Largest { 4294967294(): string { return "the largest index"; } }
block("the largest index", () => { said.push("" + (table[1](new Largest(), 4294967294) as () => string)()); });

block("arrays behind all that", () => { const numbers = [1, 2, 3]; numbers.push(4); const holes: unknown[] = [1, , 3]; said.push("arrays behind all that: " + numbers.join() + " | " + holes[1] + " | " + holes.length); });
console.log(said.join("\n"));
const m: any = untyped;
console.log(m.all().join("\n")); console.log(m.lines.join("\n"));
export {};

// FILE: untyped-classes-with-index-named-members.js
"use strict";
function block(said, name, body) { try { body(); } catch (error) { said.push(name + ": THROWS " + error.constructor.name); } }
function storeAt2(target, value) { target[2] = value; }
function readAt(target, index) { return target[index]; }
var table = [storeAt2, readAt];
function all() {
    var said = [];
    block(said, "untyped", function () {
        class Plain { set 2(v) { said.push("Plain's setter " + v); } get 3() { return "Plain's getter"; } 4() { return "Plain's method"; } }
        var o = new Plain(); table[0](o, "p"); said.push("untyped: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + o[3] + " | " + typeof o[4]);
    });
    block(said, "untyped, at the top", function () { var o = new AtTheTop(); table[0](o, "q"); said.push("untyped, at the top: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + table[1](o, 3) + " | " + typeof table[1](o, 4)); });
    block(said, "untyped, static", function () { said.push("untyped, static: " + typeof StaticAtTheTop[2] + " | " + StaticAtTheTop[3]); StaticAtTheTop[4] = "r"; });
    block(said, "untyped, an array", function () { var o = Object.setPrototypeOf(["a", "b", , "d"], ForArray.prototype); table[0](o, "s"); said.push("untyped, an array given the prototype: own 2: " + Object.prototype.hasOwnProperty.call(o, 2)); });
    block(said, "untyped, defineProperty first", function () {
        var o = new DefinedLater(); Object.defineProperty(DefinedLater.prototype, 2, { get() { return "defined at 2 on a class still unmade"; }, set(v) { said.push("the setter defined later " + v); }, configurable: true });
        o[2] = "t"; said.push("untyped, defineProperty first: own 2: " + Object.prototype.hasOwnProperty.call(o, 2) + " | " + o[2] + " | " + o.named());
    });
    block(said, "untyped, an heir", function () { var o = new Heir(); o[4] = "u"; said.push("untyped, an heir: own 4: " + Object.prototype.hasOwnProperty.call(o, 4) + " | " + o[3] + " | " + o.viaSuper()); });
    return said;
}
class AtTheTop { set 2(v) { lines.push("AtTheTop's setter " + v); } get 3() { return "AtTheTop's getter"; } 4() { return "AtTheTop's method"; } }
class StaticAtTheTop { static 2() { return 2; } static get 3() { return "StaticAtTheTop's getter"; } static set 4(v) { lines.push("StaticAtTheTop's setter " + v); } }
class ForArray { set 2(v) { lines.push("ForArray's setter " + v); } }
class DefinedLater { named() { return "DefinedLater's named"; } }
class Base { 2() { return "Base's 2"; } get 3() { return "Base's 3"; } set 4(v) { lines.push("Base's setter " + v); } }
class Heir extends Base { viaSuper() { return super[2]() + " by super"; } }
var lines = [];
module.exports = { all, lines };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: block readAt Typed1 0 5 Heir1 viaSuper
// CHECK-LABEL: function {{*}}name="block"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Call v1 calleeName="body"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="said"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = String string=": THROWS "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Convert v3 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = PropGet v9 key="constructor"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|function site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = PropGet v11 key="name"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: v15 = Call v6, v5, v14 calleeKey="push" calleeName="said.push"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="readAt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=number site=[[w_7]]}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: v3 = ElemGet v2, v1
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Typed1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="0"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="ReadFirst's getter"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="5"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="said"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = String string="ReflectFirst's setter "
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = Call v3, v2, v5 calleeKey="push" calleeName="said.push"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_12]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="viaSuper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_14]] site=[[w_15]]} results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_14]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = SuperGet v2, v0, v3
// CHECK-NEXT: v5 = Call v4, v0 calleeName="super[2]"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = String string=" by super"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
