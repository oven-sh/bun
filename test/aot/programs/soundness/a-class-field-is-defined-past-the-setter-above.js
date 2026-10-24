const log = [];
class WithSetter { set x(v) { log.push("setter " + v); } get x() { return "got"; } }
class Field extends WithSetter { x = 1; }
class FieldWithoutValue extends WithSetter { x; }
class StoresInConstructor extends WithSetter { constructor() { super(); this.x = 2; } }
class StaticSetter { static set y(v) { log.push("static setter " + v); } }
class StaticField extends StaticSetter { static y = 3; }
for (const make of [() => new Field(), () => new FieldWithoutValue(), () => new StoresInConstructor()]) {
  const o = make();
  console.log(String(o.x), Object.hasOwn(o, "x"), log.splice(0).join());
  o.x = 9;
  console.log(String(o.x), Object.hasOwn(o, "x"), log.splice(0).join());
}
console.log(StaticField.y, Object.hasOwn(StaticField, "y"), log.splice(0).join());
