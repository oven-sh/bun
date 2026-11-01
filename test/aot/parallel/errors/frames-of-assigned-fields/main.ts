// Prints the frames of what the values of class fields throw, and what they make, under "useDefineForClassFields": false: the values are code of the constructor there, which `bun run` writes if the class has none.
// @ts-nocheck
const frames = (error: any) => String(error && error.stack).split("\n").slice(1, 7).map(line => line.trim().replace(/^at /, "").replace(/\(?[^ (]*\.ts:/, "(").replace(/^\((\d+:\d+)$/, "($1)")).join(" < ");
function attempt(run: () => unknown) { try { const result = run(); console.log(run.name + ": nothing " + typeof result + " " + JSON.stringify(result)); } catch (error: any) { console.log(run.name + ": " + (error && error.constructor.name) + " " + frames(error)); } }
const hide = <T,>(value: T): T => [value, 0 as any][Number(process.argv.length > 100)];
const nothing: any = hide(undefined);
function fail(): never { throw new Error("thrown"); }
class Throws { constructor() { fail(); } }
class Plain { base = 1; }
attempt(function field() { class A { x = fail(); } return new A(); });
attempt(function fieldSecond() { class A { w = 1; x = fail(); } return new A(); });
attempt(function fieldOfDerived() { class A extends Plain { x = fail(); } return new A(); });
attempt(function fieldWithConstructor() { class A { x = fail(); constructor() { hide(1); } } return new A(); });
attempt(function fieldOfDerivedWithConstructor() { class A extends Plain { x = fail(); constructor() { super(); hide(1); } } return new A(); });
attempt(function fieldReadsNothing() { class A { x = nothing.y; } return new A(); });
attempt(function fieldReadsNothingDerived() { class A extends Plain { w = 1; x = nothing.y; } return new A(); });
attempt(function fieldArrow() { class A { x = () => fail(); } return new A().x(); });
attempt(function fieldArrowThis() { class A { w = 5; x = () => this.w; } return new A().x(); });
attempt(function fieldArrowThisDerived() { class A extends Plain { x = () => this.base; } return new A().x(); });
attempt(function fieldFunction() { class A { x = function () { return fail(); }; } return new A().x(); });
attempt(function fieldReadsThis() { class A { w = 2; x = this.w + 1; } return new A(); });
attempt(function fieldReadsOuter() { const outer = hide(7); class A { x = outer; y = () => outer; } const a = new A(); return [a.x, a.y()]; });
attempt(function privateField() { class A { #x = fail(); get() { return this.#x; } } return new A(); });
attempt(function privateAndPublic() { class A { #x = 1; y = this.#x + 1; z = fail(); } return new A(); });
attempt(function baseThrows() { class A extends Throws { x = 1; } return new A(); });
attempt(function baseThrowsWritten() { class A extends Throws { x = 1; constructor() { super(); } } return new A(); });
attempt(function parameterProperty() { class A { y = fail(); constructor(public x: number) {} } return new A(1); });
attempt(function parameterPropertyRead() { class A { y = this.x + 1; constructor(public x: number) {} } return new A(1); });
attempt(function classExpression() { const A = class { x = fail(); }; hide(A); return new A(); });
attempt(function namedClassExpression() { const A = class Named { x = fail(); }; hide(A); return new A(); });
attempt(function setterAbove() { class B { set x(v: number) { fail(); } } class A extends B { x = 1; } return new A(); });
attempt(function readOnlyAbove() { "use strict"; class B { get x() { return 1; } } class A extends B { x = 2; } return new A(); });
attempt(function noValue() { class B { set x(v: number) { fail(); } } class A extends B { x: number; } return new A(); });
attempt(function twoLevels() { class B extends Plain { b = 1; } class A extends B { x = fail(); } return new A(); });
attempt(function fieldsInOrder() { const seen: string[] = []; class A { a = seen.push("a"); b = seen.push("b"); constructor() { seen.push("c"); } } new A(); return seen; });
attempt(function fieldsAfterSuper() { const seen: string[] = []; class B { constructor() { seen.push("base"); } } class A extends B { a = seen.push("a"); constructor() { seen.push("before"); super(); seen.push("after"); } } new A(); return seen; });
attempt(function callsClass() { class A { x = 1; } return (A as any)(); });
attempt(function toStringOfClass() { class A { x = 1; } return typeof A.toString(); });
attempt(function lengthAndName() { class A extends Plain { x = 1; } return [A.length, A.name]; });
attempt(function reflected() { class A extends Plain { x = fail(); } return Reflect.construct(A, []); });
attempt(function keys() { class A extends Plain { x = 1; y; z = 3; } return Object.keys(new A()); });
attempt(function staticField() { class A { static x = fail(); y = 1; } return A; });
attempt(function computedKey() { const k = hide("k"); class A { [k] = fail(); } return new A(); });
attempt(function stringKey() { class A { "a b" = fail(); } return new A(); });
attempt(function numberKey() { class A { 1 = fail(); } return new A(); });
attempt(function classInField() { class A { x = class { y = fail(); }; } return new (new A().x)(); });
attempt(function awaitedLater() { class A { x = (async () => { await 1; return this; })(); } return typeof new A().x.then; });
attempt(function generatorInField() { class A { w = 4; x = [...(function* (self) { yield self.w; })(this)]; } return new A(); });
attempt(function superInField() { class B { m() { return 6; } } class A extends B { x = super.m(); } return new A(); });
attempt(function superInFieldArrow() { class B { m() { return 6; } } class A extends B { x = () => super.m(); } return new A().x(); });
attempt(function manyInstances() { class A { x = hide(1); y = [this.x]; } let last; for (let i = 0; i < 100; i++) last = new A(); return last; });
