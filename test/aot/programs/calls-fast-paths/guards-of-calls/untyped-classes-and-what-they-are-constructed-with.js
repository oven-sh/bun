export function Base(a) { this.a = a; }
Base.prototype.who = function () { return "Base"; };
export class Derived extends Base { constructor(a) { super(a); this.b = 2; } }
export class Heir extends Derived { constructor(a) { super(a); this.c = 3; } }
export class ClassBase { constructor(a) { this.a = a; } }
export class DerivedOfClass extends ClassBase { constructor(a) { super(a); this.b = 2; } }
export function constructWith(constructor, newTarget) {
    const made = Reflect.construct(constructor, [1], newTarget);
    const prototype = Object.getPrototypeOf(made);
    return [made.a, made.b, made.c, prototype === newTarget.prototype, prototype === Object.prototype, made instanceof constructor, Array.isArray(made)].join();
}
export function ownCallOf(f) { return f.call(null, 1); }
export function ownApplyOf(f) { return f.apply(null, [1]); }
export class UntypedWithItsOwn { static call() { return "the untyped class's own call"; } static apply() { return "the untyped class's own apply"; } }
export class UntypedWithout { }
export class UntypedHeir extends UntypedWithItsOwn { }
export function putOn(object, key, value) { object[key] = value; }
export function defineOn(object, key, value) { Object.defineProperty(object, key, { value, configurable: true, writable: true, enumerable: false }); }
export function inheritFrom(object, parent) { Object.setPrototypeOf(object, parent); }
export function untypedFunction(a) { return "untypedFunction called " + a; }
export function anotherUntypedFunction(a) { return "anotherUntypedFunction called " + a; }
export function callNamed() { return [untypedFunction.call(null, 1), untypedFunction.apply(null, [2]), anotherUntypedFunction.call(null, 3)].join(" | "); }
