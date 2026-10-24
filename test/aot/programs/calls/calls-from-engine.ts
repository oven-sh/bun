// Built-in functions written in C++ call compiled functions: results, `this`, argument counts, exceptions on the way back, and nested calls into built-ins.
declare const console: any;
const log: any[] = [];
const numbers = [5, 3, 9, 1];
log.push([...numbers].sort((a, b) => a - b).join(","), "a-b-c".replace(/-/g, (m: string, at: number) => String(at)), JSON.stringify(JSON.parse('{"a":1,"b":[2]}', function (this: any, k: string, v: any) { return typeof v === "number" ? v + 1 : v; })));
log.push(Array.from({ length: 3 }, (_: any, i: number) => i * 2).join(","), Array.from(new Set([1, 2]), function (this: any, v: number) { return v + this.add; }, { add: 10 }).join(","));
log.push(JSON.stringify({ a: 1, toJSON(this: any, key: string) { return { was: this.a, key }; } }), String({ toString() { return "converted"; } }), `${{ [Symbol.toPrimitive](hint: string) { return hint; } }}`);
try { [1, 2].sort(() => { throw new RangeError("from the comparator"); }); } catch (e: any) { log.push(e.message); }
try { JSON.parse("[1]", () => { throw new RangeError("from the reviver"); }); } catch (e: any) { log.push(e.message); }
const nested = [3, 1, 2].sort((a, b) => [a, b].sort((x, y) => x - y)[0] === a ? -1 : 1);
log.push(nested.join(","));
const rest: any = (...a: any[]) => a.length; const many: any = (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any) => String(a) + String(j);
log.push(Reflect.apply(rest, null, [1, 2, 3]), Reflect.apply(many, null, [1]), Reflect.apply(many, null, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
const proxied: any = new Proxy(function (this: any, a: number) { return a * 2; }, {});
log.push(proxied(21), new Map([[1, 2]]).forEach(function (this: any, v: number, k: number) { log.push("forEach " + k + v + this.tag); }, { tag: "t" }));
async function asynchronous(x: number) { const y = await x; const z = await Promise.resolve(y + 1); try { await Promise.reject(new RangeError("rejected")); } catch (e: any) { return z + " " + e.message; } }
async function throwing() { await null; throw new RangeError("thrown after await"); }
async function* generating() { yield 1; const x = await 2; yield x; }
(async () => {
  log.push(await asynchronous(1));
  try { await throwing(); } catch (e: any) { log.push(e.message); }
  for await (const v of generating()) log.push("yielded " + v);
  await Promise.resolve(1).then((v: number) => { log.push("then " + v); throw new RangeError("from then"); }).catch((e: any) => { log.push("catch " + e.message); }).finally(() => { log.push("finally"); });
  log.push((await Promise.all([1, Promise.resolve(2), asynchronous(3)])).join(";"));
  await new Promise<void>((resolve) => { Promise.resolve().then(() => { log.push("microtask"); resolve(); }); });
  console.log(log.map(String).join("\n"));
})();
export {};
