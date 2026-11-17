type Op = () => any; const log: string[] = [], out: string[] = [], box = { boxed: 1 };
function adds(l: unknown[], x: Op) { return l.push(x()); } function last(l: unknown[], x: Op) { return l.indexOf(x()); }
function lastOfAny(l: any, x: Op) { return l.indexOf(x()); } function cuts(t: string, x: Op) { return t.substring(x(), 3); }
function Made(this: any, k: number, r: any, x: Op) { this.w = 1; return k === 0 ? adds(r, x) : k === 1 ? last(r, x) : k === 2 ? lastOfAny(r, x) : cuts(r, x); }
const doors: Record<string, (k: number, r: any, x: Op) => any> = {
  inTail(k, r, x) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return k === 0 ? adds(r, x) : k === 1 ? last(r, x) : k === 2 ? lastOfAny(r, x) : cuts(r, x); },
  back(k, r, x) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const v = k === 0 ? adds(r, x) : k === 1 ? last(r, x) : k === 2 ? lastOfAny(r, x) : cuts(r, x); return "<" + String(v) + ">" + w; },
  tried(k, r, x) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; try { return k === 0 ? adds(r, x) : k === 1 ? last(r, x) : k === 2 ? lastOfAny(r, x) : cuts(r, x); } catch (e) { return "caught " + (e as Error).name; } finally { log.push("f"); } },
  toInt(k, r, x) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return (k === 0 ? adds(r, x) : k === 1 ? last(r, x) : k === 2 ? lastOfAny(r, x) : cuts(r, x)) | 0; },
  made(k, r, x) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const m = new (Made as any)(k, r, x); return m === box ? "box" : m instanceof Made ? "this" : typeof m; } };
async function waits(k: number, r: any, x: Op) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; if (k === 0) return await adds(r, x); if (k === 1) return await last(r, x); if (k === 2) return await lastOfAny(r, x); return await cuts(r, x); }
const makers: Record<string, () => any> = { list: () => JSON.parse('[3,"b",5]'), text: () => JSON.parse('"abcb"'), number: () => JSON.parse("5"), table: () => new Map([[1, 1]]), nothing: () => JSON.parse("null"), absent: () => undefined, proxy: () => new Proxy([3, "b"], { get(t, k, s) { log.push("get " + String(k)); return Reflect.get(t, k, s); } }), own: () => Object.assign([3, "b"], { indexOf: () => "own", push: () => "own" }), heir: () => new (class extends Array<unknown> { indexOf() { return -7; } push() { return -8; } })(), plainHeir: () => (class extends Array<unknown> {}).of<unknown>(3, "b"), frozen: () => Object.freeze([3, "b"]), gives: () => ({ indexOf: () => box, push: () => box, substring: () => box }), getter: () => ({ get push() { log.push("g"); return (v: unknown) => v; } }) };
async function main() { for (const m in makers) for (const lays of [false, true]) for (const name of JSON.parse('["inTail","back","tried","toInt","made","waits"]') as string[]) { const said: string[] = []; log.length = 0;
  for (let k = 0; k < 4; k++) { const r = makers[m](), x = () => { log.push("o"); if (lays) try { r.indexOf = r.push = r.substring = () => "late"; } catch {} return "b"; };
    for (let turn = 0; turn < 2; turn++) try { said.push(String(name === "waits" ? await waits(k, r, x) : doors[name](k, r, x))); } catch (e) { said.push((e as Error).name); } }
  out.push([m, lays, name, said.join("|"), log.join(">")].join(" ")); } }
main().then(() => console.log("SAID\n" + out.join("\n"))); export {};
