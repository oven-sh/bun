// `b.x = 1` where the class of b has a method x and a class above has a setter x: the method is the first that has the name, it is a writable data property, so the store
// creates a property of b and no setter runs. Nothing in this program changes a class after its definition.
"use strict";
const log = [];
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
function show(o, key) { return `${typeof o[key]}:${Object.hasOwn(o, key)}`; }
class WithSetter { set x(v) { log.push("setter " + v); } get x() { return "got"; } }
class HidesSetter extends WithSetter { x() { return "method"; } }
class BelowHidden extends HidesSetter {}
class WithGetterAlone { get x() { return "only got"; } }
class HidesGetter extends WithGetterAlone { x() {} }
class BelowGetter extends WithGetterAlone {}
function store(o, v) { o.x = v; return show(o, "x"); }

const b = new HidesSetter();
b.x = 1;
console.log(show(b, "x"), log.splice(0).join());
for (const make of [() => new WithSetter(), () => new HidesSetter(), () => new BelowHidden(), () => new WithGetterAlone(), () => new HidesGetter(), () => new BelowGetter()]) {
  const answers = [];
  for (let i = 0; i < 3; i++) answers.push(attempt(() => store(make(), i)));
  console.log(answers.join(" "), log.splice(0).join());
}
console.log(attempt(() => { const o = new BelowHidden(); o.x = 2; return show(o, "x"); }), attempt(() => { const o = new HidesGetter(); o.x = 3; return show(o, "x"); }), log.splice(0).join());

class StoresInConstructor extends HidesSetter { constructor() { super(); this.x = 5; } }
console.log(show(new StoresInConstructor(), "x"), log.splice(0).join());

class StaticSetter { static set y(v) { log.push("static setter " + v); } }
class StaticHides extends StaticSetter { static y() {} }
class StaticBelow extends StaticHides {}
StaticHides.y = 1; StaticBelow.y = 2; StaticSetter.y = 3;
console.log(show(StaticHides, "y"), show(StaticBelow, "y"), show(StaticSetter, "y"), log.splice(0).join());

{ const o = new HidesSetter(); o.x ??= 1; o.x &&= 2; console.log(o.x, Object.hasOwn(o, "x"), log.splice(0).join()); }
class Named { toString() { return "named"; } }
{ const o = new Named(); o.toString = () => "own"; console.log(String(o), Object.hasOwn(o, "toString"), String(new Named())); }
