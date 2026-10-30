// Object.assign and a spread copy an object that holds itself, or that holds the target or another operand. Object.freeze, seal and preventExtensions are applied to objects with accessors and to arguments objects. What a program can see is what plain Bun shows, and a validating build has nothing to find.
// Flags: --aot-validate
function show(what, f) { let last; for (let round = 0; round < 50; round++) last = f(); console.log(what, JSON.stringify(last)); }
show("the source holds itself", () => { const a = {}, b = { x: 1 }; b.me = b; Object.assign(a, b); return [a.me === b, a.x, Object.keys(a)]; });
show("the source holds the target", () => { const a = { y: 2 }, b = { x: 1 }; b.other = a; Object.assign(a, b); return [a.other === a, a.x, a.y]; });
show("one source holds the next", () => { const a = {}, c = { z: 3 }, b = { next: c }; Object.assign(a, b, c); return [a.next === c, a.z]; });
show("late fields", () => { const a = {}, b = {}; for (let i = 0; i < 12; i++) b["f" + i] = i; b.self = b; Object.assign(a, b); return [a.self === b, Object.keys(a).length]; });
show("a spread of an object that holds itself", () => { const b = { x: 1 }; b.me = b; const a = { ...b }; return [a.me === b, a !== b]; });
show("under a symbol", () => { const key = Symbol.for("self"); const a = {}, b = {}; b[key] = b; Object.assign(a, b); return a[key] === b; });
show("an array that holds itself", () => { const a = {}, b = [1]; b.push(b); Object.assign(a, b); return [a[1] === b, a[0]]; });
function frozen() { return [Object.isFrozen(Object.freeze(arguments)), arguments.length, arguments[0]]; }
function sealed() { return [Object.isSealed(Object.seal(arguments)), arguments.length, arguments[1]]; }
function closed() { return [Object.isExtensible(Object.preventExtensions(arguments)), arguments.length]; }
function described() { const before = Object.getOwnPropertyDescriptor(arguments, "callee"); Object.freeze(arguments); const after = Object.getOwnPropertyDescriptor(arguments, "callee"); return [before.get === after.get, before.set === after.set, after.configurable, after.enumerable, Object.getOwnPropertyNames(arguments)]; }
show("arguments, frozen", () => frozen(1, 2));
show("arguments, sealed", () => sealed(1, 2));
show("arguments, closed", () => closed(1, 2));
show("arguments, the accessor under callee", () => described(1, 2));
show("an accessor, frozen", () => { const get = () => 1, set = () => {}; const o = Object.defineProperty({ x: 1 }, "a", { get, set, configurable: true, enumerable: true }); Object.freeze(o); const d = Object.getOwnPropertyDescriptor(o, "a"); return [d.get === get, d.set === set, d.configurable, o.a, Object.isFrozen(o)]; });
show("an accessor, sealed", () => { const get = () => 1; const o = Object.defineProperty({ x: 1 }, "a", { get, configurable: true }); Object.seal(o); const d = Object.getOwnPropertyDescriptor(o, "a"); return [d.get === get, d.set, d.configurable, Object.isSealed(o)]; });
show("an accessor, defined anew with the same functions", () => { const get = () => 1; const o = Object.defineProperty({}, "a", { get, configurable: true }); Object.defineProperty(o, "a", { get }); return Object.getOwnPropertyDescriptor(o, "a").get === get; });
show("an accessor, defined anew with another function", () => { const o = Object.defineProperty({}, "a", { get: () => 1, configurable: true }); Object.defineProperty(o, "a", { get: () => 2 }); return o.a; });
