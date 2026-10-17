// The optimized forms of `call`, `apply`, spread and `arguments` inside `try` blocks: exceptions still reach the right `catch` block.
declare const console: any;
const log: any[] = [];
const text = (x: any) => typeof x === "function" ? "fn" : String(x);
const thrower: any = function (this: any, a: any) { throw new RangeError("thrown " + text(a) + " " + String(this)); };
const show: any = function (this: any, ...a: any[]) { return a.length + ":" + a.map(text).join(","); };
function rest(...v: any[]) { return v.length + v[0]; }
function forward(this: any, f: any) { try { return f.apply(this, arguments); } catch (e: any) { return "caught " + (e instanceof RangeError ? e.message : e.constructor.name) + " " + arguments.length; } finally { log.push("finally " + arguments.length); } }
for (const f of [thrower, show, undefined, {}]) {
  try { log.push((f as any).call("t", 1)); } catch (e: any) { log.push(e.constructor.name + " " + (e instanceof RangeError ? e.message : "")); }
  try { log.push((f as any).apply("t", [1, 2])); } catch (e: any) { log.push(e.constructor.name + " " + (e instanceof RangeError ? e.message : "")); }
  try { const a = [1, 2]; log.push(a.length, a[0], a[5], (f as any).apply("t", a), a.length); } catch (e: any) { log.push(e.constructor.name); }
  try { log.push(rest(1, 2), typeof f === "function", (f as any)(...[1, 2])); } catch (e: any) { log.push(e.constructor.name); }
  try { log.push((forward as any).call("t", f, 1)); } catch (e: any) { log.push("outer " + e.constructor.name); }
}
console.log(log.map(String).join("\n"));
export {};
