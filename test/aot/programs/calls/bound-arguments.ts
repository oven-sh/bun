// Calls of `f.bind(thisArg, a, ..)`: bound arguments come first, are kept alive by the bound function, and `new` works.
declare const console: any;
const rest: any = function (this: any, ...a: any[]) { return String(this) + "/" + a.length + ":" + a.join(); };
const fixed3: any = function (this: any, a: any, b: any, c: any) { return String(this) + "/" + [a, b, c].map(String).join(); };
const fixed0: any = function (this: any) { return String(this) + "/" + arguments.length; };
const fixed10: any = function (this: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any) { return String(this) + "/" + [a, b, c, d, e, f, g, h, i, j].map(String).join(); };
const arrow: any = (a: any, b: any) => String(a) + "," + String(b);
const withProperty: any = function (this: any, a: any, b: any) { return String(this) + "/" + a + b; }; withProperty.extra = 1;
async function asynchronous(this: any, a: any, b: any) { return String(this) + "/" + a + b; }
class K { static s(this: any, a: any, b: any) { return (this === K) + "/" + a + b; } }
const targets: [string, any][] = [["rest", rest], ["fixed3", fixed3], ["fixed0", fixed0], ["fixed10", fixed10], ["arrow", arrow], ["withProperty", withProperty], ["max", Math.max], ["concat", String.prototype.concat], ["static", K.s],
  ["bound", rest.bind("inner", "i1")], ["bound2", fixed3.bind("inner", "i1", "i2")], ["call", Function.prototype.call], ["apply", Function.prototype.apply], ["proxy", new Proxy(rest, {})]];
const values = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const lines: string[] = [];
for (const [name, target] of targets) {
  for (let boundCount = 0; boundCount <= 5; boundCount++) {
    const thisArgument = name === "call" || name === "apply" ? rest : name === "static" ? K : "T";
    const bound: any = target.bind(thisArgument, ...values.slice(0, boundCount).map(v => name === "max" ? v.charCodeAt(0) : name === "apply" && v === "b" ? ["x", "y"] : v.toUpperCase()));
    let line = name + " " + boundCount + ":";
    for (let round = 0; round < 2; round++) {
      let r: any[] = [];
      try {
        r = [bound(), bound(1), bound(1, 2), bound(1, 2, 3), bound(1, 2, 3, 4), bound(1, 2, 3, 4, 5), bound(1, 2, 3, 4, 5, 6), bound(1, 2, 3, 4, 5, 6, 7), bound(1, 2, 3, 4, 5, 6, 7, 8), bound(1, 2, 3, 4, 5, 6, 7, 8, 9),
          bound.call("other", 1), bound.apply("other", [1, 2]), bound(...[1, 2, 3])];
      } catch (e: any) { r.push("threw " + e.constructor.name); }
      line += " " + r.map(String).join(" | ");
    }
    lines.push(line);
  }
}
console.log(lines.join("\n"));
// Bound values are stored, not re-read; objects stay alive through the bound function alone; a bound function that was given a property; `new`.
{
  const list = [1]; const f: any = rest.bind(list, list, { toString() { return "obj"; } }); list.push(2);
  console.log(f(3), f.name, f.length);
  f.extra = 1; console.log(f(4));
  const made: any[] = []; for (let i = 0; i < 2000; i++) made.push(fixed3.bind({ toString() { return "t" + i; } }, { toString() { return "a" + i; } }, [i]));
  let s = 0; for (const g of made) s += g("z").length; console.log(s, made[1999]("z"));
  function Point(this: any, x: any, y: any, z: any) { this.x = x; this.y = y; this.z = z; }
  const P: any = (Point as any).bind("ignored", 1, 2); const p = new P(3); console.log(p.x, p.y, p.z, p instanceof (Point as any));
}
asynchronous.bind("T", "x")("y").then((r: any) => console.log(r));
export {};
