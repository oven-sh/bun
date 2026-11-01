// A function of a boolean is called with a value that is not one, so it goes on in its slower version. There the value is
// read by a call that makes text of it and is then tested, while a few more numbers stay alive across later calls than
// there are registers that outlive a call. The register allocator splits the value's live range, sometimes twice, and
// the call must still find the value. Each part of the program stays the same two times in three.
import type { Random } from "./random";

export function generate(random: Random): string {
  const part = (usual: string, others: string[]) => (random.chance(2 / 3) ? usual : random.pick(others));
  const fields = part("a!: number; constructor(v: number) {}", [
    "a: number = 0; constructor(v: number) {}",
    "a: number; constructor(v: number) { this.a = v; }",
    "a!: number; c!: number; constructor(v: number) {}",
    "a!: string; constructor(v: number) {}",
  ]);
  const reader = part("`<${b}>`", ["String(b)", '"" + b', "`${b}`", "`<${b}|${b}>`", "`<${b}>` + s", "[b].join()"]);
  const x = part("b ? 0 : 1", ["b ? 1 : 0", "b ? 2 : 3", "b ? 0 : 0.5", "Number(!b)", "b ? s.length : 1"]);
  const y = part("b ? 2 : 0", ["b ? 0 : 2", "b ? 3 : 1", "b ? 2 : 0.5", "b ? 2 : s.length"]);
  const z = part("x * y", ["x + y", "x | y", "x - y", "x ^ y", "(x * y) | 0", "x * y * 2"]);
  const test = part("(z & 3) === 0", ["(z & 1) === 0", "z === 0", "(z & 3) !== 1", "z < 3", "true"]);
  const inner = part("if (b) { console.log(t + s); }", [
    "console.log(t + s);",
    "if (!b) { console.log(t + s); } else { console.log(s + t); }",
    "if (b) { console.log(t + s, z); }",
    "if (b) { console.log(t); console.log(s); }",
  ]);
  const first = part("new K(x);", ["new K(y);", "new K(z);", "new K(x); new K(z);", "g(x);", ""]);
  const second = part("x < (3 ^ (1 | z))", [
    "x < z",
    "x <= (y | 1)",
    "y < (3 ^ (1 | z))",
    "x < (3 ^ (1 | z)) && b",
    "x + y < 9",
  ]);
  const last = part("new K(y);", ["new K(x);", "new K(x + y);", "new K(y); new K(z);", "g(y);"]);
  const tail = part("", ['if (b) console.log("still", typeof b);', "console.log(x, y, z);", "console.log(t.length);"]);
  const turns = part("5", ["1", "2", "3", "0", "9"]);
  const honest = part("true", ["false", "i % 2 === 0"]);
  const odd = part('r["toString"]', [
    'r["constructor"]',
    'r["__proto__"]',
    'r["none"]',
    "(Object.prototype.toString as any)",
    '("text" as any)',
    "(0 as any)",
    "(1.5 as any)",
    "({} as any)",
    "(null as any)",
    "(Symbol.iterator as any)",
  ]);
  const fraction = part("g(0.5);", ["g(1);", "", "g(0.5); g(1);", "g(-0);"]);
  const after = part('f(false, "x");', ['f(true, "x");', "", 'f(false, "x"); f(true, "y");', 'f(odd, "again");']);
  return `class K { ${fields} }
function f(b: boolean, s: string): void {
  const t: string = ${reader};
  const x: number = ${x};
  const y: number = ${y};
  const z: number = ${z};
  if (${test}) { ${inner} }
  ${first}
  if (${second}) { ${last} }
  ${tail}
}
function g(n: number): void { new K(n); }
for (let i = 0; i < ${turns}; i++) f(${honest}, "true");
const r: Record<string, boolean> = { k: false };
const odd: boolean = ${odd};
try { f(odd, "odd"); } catch (e) { console.log("throws", (e as Error).name, (e as Error).message); }
${fraction}
try { ${after} } catch (e) { console.log("throws", (e as Error).name, (e as Error).message); }
console.log("end");
`;
}
