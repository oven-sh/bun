type Options = { n: number; b: boolean; d: number };
function withDefaults(o: Partial<Options>): Options { return { n: 1, b: true, d: 0.5, ...o }; }
function sum(o: Options): number { return o.n + (o.b ? 1 : 0) + o.d; }
const separator = process.argv.length > 99 ? "" : ";";
const hide = new Function("x", ["return x", ""].join(separator)) as <T>(x: T) => T;
const stranger = new Function("o", "v", ["o.n = v", "o.b = v", "o.d = v"].join(separator)) as (o: object, v: unknown) => void;
let total = 0;
const out: string[] = [];
for (let i = 0; i < 200; i++) {
  const first = withDefaults({});
  first.n = i; first.d = i / 2;
  if (i % 50 === 49) stranger(first, i % 100 === 99 ? undefined : null);
  const second = withDefaults(hide(first));
  const third = withDefaults(hide(second));
  if (i % 50 === 49) out.push(String(second.n), String(second.b), String(second.d), String(sum(third)), JSON.stringify(third));
  else total += sum(third);
}
console.log(total, out.join(" "));
