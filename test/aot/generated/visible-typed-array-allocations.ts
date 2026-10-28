// `new Uint8Array(x)` where the compiler sees the array being made: what x is (a length, or a buffer that can be resized, grown or detached, an array,
// an iterable ..), how much the compiler knows of x, what happens to the buffer between there and the access, and the access. A view that goes by
// its buffer and is read by a length of its own reads memory that is not its. Each cell is a function of its own and runs twice.

/** What the array is made of: its name, the expression, its type in TypeScript. */
// prettier-ignore
const made: [string, string, string][] = [
  ["8", "8", "number"],
  ["0", "0", "number"],
  ["a text", "\"8\"", "any"],
  ["undefined", "undefined", "any"],
  ["null", "null", "any"],
  ["true", "true", "any"],
  ["8.5", "8.5", "number"],
  ["-1", "-1", "number"],
  ["NaN", "NaN", "number"],
  ["an object with valueOf", "{ valueOf() { return 8; } }", "any"],
  ["array-like", "{ length: 8, 0: 1, 7: 7 }", "any"],
  ["an array", "[1, 2, 3, 4, 5, 6, 7, 8]", "number[]"],
  ["a set", "new Set([1, 2, 3, 4, 5, 6, 7, 8])", "any"],
  ["a buffer", "(B = new ArrayBuffer(8))", "ArrayBuffer"],
  ["a resizable buffer", "(B = new ArrayBuffer(8, { maxByteLength: 65536 }))", "ArrayBuffer"],
  ["a growable shared buffer", "(B = new SharedArrayBuffer(8, { maxByteLength: 65536 }))", "any"],
  ["a shared buffer", "(B = new SharedArrayBuffer(8))", "any"],
  ["a view of a resizable buffer", "new Uint8Array((B = new ArrayBuffer(8, { maxByteLength: 65536 })))", "Uint8Array"],
  ["a view born with a length", "new Uint8Array(8)", "Uint8Array"],
];
// prettier-ignore
const between: [string, string][] = [
  ["nothing", ""],
  ["shrinks", "resize(4);"],
  ["grows", "resize(4096);"],
  ["to nothing", "resize(0);"],
  ["shrinks and grows again", "resize(2); resize(16);"],
  ["is transferred", "transfer(a);"],
  ["is handed to structuredClone", "cloneAway(a);"],
];
// prettier-ignore
const accesses: [string, string][] = [
  ["length", "a.length"],
  ["byteLength", "a.byteLength"],
  ["a[0]", "a[0]"],
  ["a[5]", "a[5]"],
  ["a[7]", "a[7]"],
  ["a[8]", "a[8]"],
  ["a[4000]", "a[4000]"],
  ["a[i] unknown 5", "a[unknown(5)]"],
  ["a[i] unknown 4000", "a[unknown(4000)]"],
  ["store at 5", "((a[5] = 9), a[5])"],
  ["store at 4000", "((a[4000] = 9), a[4000])"],
  ["store at unknown 5", "((a[unknown(5)] = 9), a[5])"],
  ["a sum by length", "(() => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] + 1; return s; })()"],
  ["a sum to 8", "(() => { let s = 0; for (let i = 0; i < 8; i++) s += (a[i] ?? 100) + 1; return s; })()"],
  ["a fill by length", "(() => { for (let i = 0; i < a.length; i++) a[i] = i; return a.length; })()"],
  ["a fill to 8", "(() => { for (let i = 0; i < 8; i++) a[i] = i + 1; return Array.from(a).join(); })()"],
  ["for of", "(() => { let s = 0; for (const v of a) s += v + 1; return s; })()"],
  ["at(-1)", "a.at(-1)"],
  ["5 in a", "5 in a"],
  ["join", "a.join()"],
  ["the length kept, then the change in the loop", "(() => { const n = a.length; let s = 0; for (let i = 0; i < n; i++) { if (i === 2) resize(3); s += (a[i] ?? 100) + 1; } return s; })()"],
  ["the change by what is stored", "(() => { a[1] = { valueOf() { resize(1); transfer(a); return 7; } }; return [a.length, a[1]].join(); })()"],
];

/** How much the compiler knows of what the array is made of. */
export const known = ["written", "a parameter", "any", "a union", "behind unknown()"] as const;
const alsoOfOtherElements = ["8", "a resizable buffer", "a buffer", "a growable shared buffer", "a view of a resizable buffer"];

const helpers = `const unknown = x => x; let B = null;
const resize = n => { if (B && B.resizable) B.resize(n); else if (B && B.growable && n > B.byteLength) B.grow(n); };
const transfer = a => { try { if (a.buffer instanceof ArrayBuffer) a.buffer.transfer(); } catch {} };
const cloneAway = a => { try { if (a.buffer instanceof ArrayBuffer) structuredClone(a.buffer, { transfer: [a.buffer] }); } catch {} };
const one = x => x === undefined ? "<undefined>" : typeof x === "number" ? (x !== x ? "<NaN>" : String(x)) : typeof x === "string" ? JSON.stringify(x) : String(x);
const say = (label, f) => { const all = []; for (let i = 0; i < 2; i++) { B = null; let r; try { r = one(f()); } catch (e) { r = "throws " + e.constructor.name; } all.push(r); } console.log(label + " ==> " + (all[0] === all[1] ? all[0] : all.join(" THEN "))); };`;

export function program(how: (typeof known)[number], isTypeScript: boolean): { file: string; text: string } {
  const lines = isTypeScript ? ["// @ts-nocheck", helpers] : [helpers];
  const typed = (type: string) => (isTypeScript ? ": " + type : "");
  let n = 0;
  for (const constructor of ["Uint8Array", "Float64Array", "Int32Array"]) {
    for (const [name, expression, type] of made) {
      if (constructor !== "Uint8Array" && !alsoOfOtherElements.includes(name)) continue;
      const [parameters, used, argument] =
        how === "written" ? ["", expression, ""]
        : how === "a parameter" ? ["x" + typed(type), "x", expression]
        : how === "any" ? ["x" + typed("any"), "x", expression]
        : how === "a union" ? ["x" + typed("number | ArrayBuffer | Uint8Array | number[]"), "x", expression + (isTypeScript ? " as any" : "")]
        : ["", "unknown(" + expression + ")", ""]; // prettier-ignore
      for (const [happens, statements] of between) {
        for (const [access, read] of accesses) {
          n++;
          lines.push(`function f${n}(${parameters}) { const a = new ${constructor}(${used}); ${statements} return ${read}; } say(${JSON.stringify(`${constructor} of ${name} | ${happens} | ${access}`)}, () => f${n}(${argument}));`);
        }
      }
    }
  }
  return { file: isTypeScript ? "main.ts" : "main.mjs", text: lines.join("\n") + "\n" };
}
