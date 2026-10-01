// JavaScript that js-control lacks: classes, methods, accessors, static blocks, private names, async arrows,
// generators, import attributes, template literals. Fixed work: the same source for every build.
//   BUN_JSC_useJIT=0 valgrind --tool=cachegrind --cache-sim=no --branch-sim=yes --vex-guest-chase=no <bun-profile> js-classes-bench.mjs --iterations=5
const unit = i => `
import data${i} from "./data${i}.json" with { type: "json" };
export class C${i} extends Base${i % 7} {
  static #count = 0;
  #value = ${i};
  static { C${i}.#count += 1; }
  constructor(a, b = 1, ...rest) { super(a); this.a = a ?? b; this.rest = rest; }
  get value() { return this.#value; }
  set value(v) { this.#value = v; }
  static create(x) { return new C${i}(x, (x + 1) * 2); }
  async load(url, { retries = 3, ...options } = {}) {
    const run = async (n) => { try { return await fetch(url, options); } catch (e) { if (n > 0) return run(n - 1); throw e; } };
    return (await run(retries)).json();
  }
  *items() { for (const [k, v] of Object.entries(this)) yield [k, v]; }
  [Symbol.iterator]() { return this.items(); }
  toString() { return \`C${i}(\${this.a}, \${this.#value})\`; }
}
export const f${i} = async (a, b) => (a, b, await Promise.all([a, b]));
label${i}: for (let j = 0; j < 3; j++) { if (j === 1) continue label${i}; new C${i}(j).toString(); }
`;
let source = "";
for (let i = 0; i < 300; i++) source += unit(i);
const iterations = Number(process.argv.find(a => a.startsWith("--iterations="))?.slice(13) ?? 1);
const transpiler = new Bun.Transpiler({ loader: "js" });
let length = 0;
for (let i = 0; i < iterations; i++) length = transpiler.transformSync(source).length;
console.log(`js-classes source ${source.length} output ${length} passes ${iterations}`);
