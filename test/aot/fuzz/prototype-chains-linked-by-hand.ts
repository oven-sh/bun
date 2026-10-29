// Constructor functions and classes whose prototype chains the program links itself, as code compiled down to ES5 and older packages do.
//
//   the link    Object.setPrototypeOf(Derived.prototype, Base.prototype), Object.create, TypeScript's __extends, util.inherits, `class extends` of a parameter
//   the base    a constructor function or a class, named directly or passed to a factory; one base per factory, or several; chains of two or three
//   the turns   instances are made and asked: own, inherited and overridden methods, calls of the base's method, getters, instanceof, for-in, constructor;
//               an own property that holds undefined hides the method above it
//   the change  in the middle the chain is linked to another base or to null, a cycle is tried, a method is added, replaced, deleted or becomes a getter,
//               `prototype` is replaced, one instance is moved to another chain
//
// Each scene prints its first turns, the turns around the change, its last turn, and a hash of every turn.
import type { Random } from "./random";

export function generate(r: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const self = typed ? "this: any, " : "";
  const selfOnly = typed ? "this: any" : "";
  const cast = (text: string) => (typed ? `(${text} as any)` : text);

  const scenes: string[] = [];
  const count = 2 + r.below(4);
  for (let n = 0; n < count; n++) {
    const turns = r.pick([12, 40, 40, 150, 500]);
    const change = r.pick([1, 2, turns >> 1, turns >> 1, turns - 2]);
    const bases: string[] = [];
    const baseNames: string[] = [];
    for (let b = 0; b < 2 + r.below(2); b++) {
      const name = `Base${n}_${b}`;
      baseNames.push(name);
      if (r.chance(0.35)) {
        bases.push(`class ${name} {
  ${typed ? "a: any;\n  " : ""}constructor(a${any}) { this.a = a; }
  name()${any} { return "${name}(" + this.a + ")"; }
  area()${any} { return this.a * ${b + 2}; }
  get size()${any} { return this.a + ${b}; }
  static make(a${any})${any} { return new this(a); }
}`);
      } else {
        bases.push(`function ${name}(${self}a${any}) { this.a = a; }
${name}.prototype.name = function (${selfOnly}) { return "${name}(" + this.a + ")"; };
${name}.prototype.area = function (${selfOnly}) { return this.a * ${b + 2}; };
Object.defineProperty(${name}.prototype, "size", { get() { return this.a + ${b}; }, configurable: true });
${cast(name)}.make = function (${self}a${any}) { return new this(a); };`);
      }
    }
    const link = r.pick([
      "setPrototypeOf",
      "setPrototypeOf",
      "setPrototypeOf",
      "create",
      "extends helper",
      "inherits",
      "class",
      "both sides",
    ]);
    const linkText: Record<string, string> = {
      "setPrototypeOf": `Object.setPrototypeOf(Derived.prototype, Base.prototype);`,
      "create": `Derived.prototype = Object.create(Base.prototype, { constructor: { value: Derived, writable: true, configurable: true } });`,
      "extends helper": `__extends(Derived, Base);`,
      "inherits": `inherits(Derived, Base);`,
      "both sides": `Object.setPrototypeOf(Derived.prototype, Base.prototype); Object.setPrototypeOf(Derived, Base);`,
    };
    const enter = r.pick([
      `const made = Reflect.construct(Base, [a], new.target || Derived); made.tag = tag; made.b = b; return made;`,
      `const made = Reflect.construct(Base, [a], new.target || Derived); made.tag = tag; made.b = b; return made;`,
      `try { Base.call(this, a); } catch (e) { this.a = a; } this.tag = tag; this.b = b;`,
      `this.a = a; this.tag = tag; this.b = b;`,
    ]);
    const overrides = r.sample(
      [
        `Derived.prototype.describe = function (${selfOnly}) { return tag + ":" + this.name() + ":" + Base.prototype.name.call(this); };`,
        `Derived.prototype.area = function (${selfOnly}) { return Base.prototype.area.call(this) + this.b; };`,
        `Derived.prototype.name = function (${selfOnly}) { return "derived " + tag; };`,
        `Derived.prototype.twice = function (${selfOnly}) { return this.area() * 2; };`,
        `Object.defineProperty(Derived.prototype, "size", { get() { return -this.a; }, configurable: true });`,
      ],
      1 + r.below(4),
    );
    const factory =
      link === "class"
        ? `function derive${n}(Base${any}, tag${any})${any} {
  return class Derived extends Base {
    ${typed ? "tag: any;\n    b: any;\n    " : ""}constructor(a${any}, b${any}) { super(a); this.tag = tag; this.b = b; }
    describe()${any} { return tag + ":" + ${cast("this")}.name() + ":" + super.name(); }
    ${r.chance(0.3) ? `twice${any};` : ``}
    ${r.chance(0.2) ? `name${any};` : ``}
    ${r.chance(0.5) ? `area()${any} { return super.area() + this.b; }` : ``}
  };
}`
        : `function derive${n}(Base${any}, tag${any})${any} {
  function Derived(${self}a${any}, b${any})${any} { ${enter} }
  ${linkText[link]}
  ${overrides.join("\n  ")}
  return Derived;
}`;
    const oneBase = r.chance(0.6);
    const made: string[] = [`const D${n}_0 = derive${n}(${baseNames[0]}, "first");`];
    made.push(`const D${n}_1 = derive${n}(${oneBase ? baseNames[0] : baseNames[1]}, "second");`);
    made.push(
      `const D${n}_2 = derive${n}(${r.pick([`D${n}_0`, `D${n}_0`, baseNames[baseNames.length - 1]])}, "third");`,
    );
    const D = () => `D${n}_${r.below(3)}`;
    const B = () => r.pick(baseNames);
    const changes = [
      `Object.setPrototypeOf(${D()}.prototype, ${B()}.prototype);`,
      `Object.setPrototypeOf(${D()}.prototype, ${B()}.prototype);`,
      `Object.setPrototypeOf(${D()}.prototype, null);`,
      `Object.setPrototypeOf(${D()}.prototype, { name() { return "a plain parent"; }, area() { return 1; } });`,
      `try { Object.setPrototypeOf(${B()}.prototype, ${D()}.prototype); out.push("linked"); } catch (e${any}) { out.push("cycle: " + e.constructor.name); }`,
      `try { Object.setPrototypeOf(D${n}_0.prototype, D${n}_2.prototype); out.push("linked"); } catch (e${any}) { out.push("cycle: " + e.constructor.name); }`,
      `${cast(B())}.prototype.name = function (${selfOnly}) { return "replaced " + this.a; };`,
      `${cast(B())}.prototype.extra = function (${selfOnly}) { return "extra " + this.a; };`,
      `delete ${D()}.prototype.area;`,
      `delete ${D()}.prototype.describe;`,
      `delete ${cast(B())}.prototype.name;`,
      `Object.defineProperty(${B()}.prototype, "name", { get() { return () => "from a getter"; }, configurable: true });`,
      `Object.defineProperty(${D()}.prototype, "a", { get() { return 100; }, set(value) {}, configurable: true });`,
      `Object.freeze(${B()}.prototype);`,
      `try { ${D()}.prototype = { name() { return "a new prototype"; }, area() { return 2; }, describe() { return "new"; } }; } catch (e${any}) { out.push("prototype: " + e.constructor.name); }`,
      `Object.defineProperty(${B()}, Symbol.hasInstance, { value: () => true, configurable: true });`,
      `${cast(B())}.prototype.constructor = Object;`,
      `Object.setPrototypeOf(${D()}, ${r.pick(["null", "Function.prototype", B()])});`,
      `moved${n} = true;`,
    ];
    const uses = [
      `out.push(show(o.name()));`,
      `out.push(show(o.area()));`,
      `out.push(show(o.describe()));`,
      `out.push(show(o.size));`,
      `out.push(show(o.twice ? o.twice() : "no twice"));`,
      `out.push(show(o.extra ? o.extra() : "no extra"));`,
      `out.push(String(o instanceof ${B()}) + String(o instanceof ${D()}));`,
      `out.push(String(${B()}.prototype.isPrototypeOf(o)));`,
      `out.push(show(o.constructor && o.constructor.name));`,
      `{ let text = ""; for (const key in o) text += key + ","; out.push(text); }`,
      `out.push(show(Object.getPrototypeOf(Object.getPrototypeOf(o)) === ${B()}.prototype));`,
      `out.push(show(o.a) + show(o.b) + show(o.tag));`,
      `out.push(show(total(o)));`,
      `out.push(show(typeof Made.make === "function" ? Made.make(turn).a : "no make"));`,
      `out.push(show(Object.keys(o).join()));`,
      `out.push(show(${cast(B())}.prototype.area.call(o)));`,
      `o.a = turn + 0.5; out.push(show(o.area()));`,
      `kept${n}.push(o); if (kept${n}.length > 4) out.push(show(kept${n}.shift().name()));`,
      `if (turn % 3 === 1) o.area = undefined; out.push(typeof o.area + String(Object.hasOwn(o, "area")));`,
      `if (turn % 4 === 2) Object.defineProperty(o, "name", { value: undefined, writable: true, configurable: true }); out.push(typeof o.name);`,
      `o.describe = turn % 2 ? undefined : null; out.push(typeof o.describe); delete o.describe; out.push(typeof o.describe);`,
      `if (turn % 5 === 3) o.size = undefined; out.push(show(o.size) + String(Object.hasOwn(o, "size")));`,
    ];
    const body: string[] = [];
    body.push(`if (turn === ${change}) { ${r.pick(changes)} }`);
    if (r.chance(0.3)) body.push(`if (turn === ${Math.min(turns - 1, change + 2)}) { ${r.pick(changes)} }`);
    body.push(`const Made${any} = turn % ${r.pick([2, 3, 7])} === 1 ? ${D()} : ${D()};`);
    body.push(`const o${any} = new Made(turn, 2);`);
    body.push(`if (moved${n} && turn % 2) Object.setPrototypeOf(o, ${r.pick([D(), B()])}.prototype);`);
    for (let k = 3 + r.below(5); k > 0; k--) body.push(r.pick(uses));

    scenes.push(`${bases.join("\n")}
${factory}
${made.join("\n")}
let moved${n} = false;
const kept${n}${typed ? ": any[]" : ""} = [];
function scene${n}(turn${typed ? ": number" : ""})${typed ? ": string" : ""} {
  const out${typed ? ": string[]" : ""} = [];
  try {
    ${body.join("\n    ")}
  } catch (e${any}) {
    out.push("threw " + (e && e.constructor ? e.constructor.name : typeof e));
  }
  return out.join(" ");
}
{
  let hash = 0;
  for (let turn = 0; turn < ${turns}; turn++) {
    const line = scene${n}(turn);
    for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
    if (turn < 2 || (turn >= ${change - 1} && turn <= ${change + 3}) || turn === ${turns - 1}) console.log("scene ${n} ${link} turn", turn, line.slice(0, 600));
  }
  console.log("scene ${n}", hash);
}`);
  }

  return `function show(value${any})${typed ? ": string" : ""} {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  return String(value);
}
var __extends = (function () {
  var extendStatics = function (d${any}, b${any})${any} {
    extendStatics = Object.setPrototypeOf || function (d${any}, b${any}) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
    return extendStatics(d, b);
  };
  return function (d${any}, b${any}) {
    if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
    extendStatics(d, b);
    function __(${selfOnly}) { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new ${cast("__")}());
  };
})();
function inherits(ctor${any}, base${any}) {
  Object.defineProperty(ctor, "super_", { value: base, writable: true, configurable: true });
  Object.setPrototypeOf(ctor.prototype, base.prototype);
}
function total(shape${any})${any} { return shape.area() + shape.size; }
${scenes.join("\n")}
`;
}
