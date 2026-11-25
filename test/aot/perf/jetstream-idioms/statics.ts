// A counter in a static field, on a function, in an object.
const literal = { v: 0 };
class Read { static v: number = 3; }
const three = { v: 3 };
class Written { static v: number = 0; }
class Counted { static v: number = 0; }
class Private { static #v: number = 0; static up(): number { Private.#v++; return Private.#v; } }
function Property(): void {}
Property.v = 0;
const loops: Record<string, (n: number) => number> = {
  "a counter in a literal": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { literal.v++; s = (s + literal.v) | 0; } return s; },
  "a field of a literal read": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + three.v) | 0; } return s; },
  "a static field read": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + Read.v) | 0; } return s; },
  "a field of a literal written": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { literal.v = i; s = (s + literal.v) | 0; } return s; },
  "a static field written": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { Written.v = i; s = (s + Written.v) | 0; } return s; },
  "a counter in a static field": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { Counted.v++; s = (s + Counted.v) | 0; } return s; },
  "a counter in a private static field": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { s = (s + Private.up()) | 0; } return s; },
  "a counter on a function": n => { let s = 0; for (let i = 0, end = n | 0; i < end; i++) { Property.v++; s = (s + Property.v) | 0; } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name]!(40));
else console.log(loops[loop]!(Number(iterations)));
export {};
