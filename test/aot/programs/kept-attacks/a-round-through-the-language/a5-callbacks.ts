// A round through the language, one probe of many. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
type P = { x: number };
const dbl = (n: number): number => n * 2;
const slen = (s: string): number => s.length;
const px = (p: P): number => p.x + 1;
const cmp = (a: P, b: P): number => a.x - b.x;
const mixed: any[] = ["a", 1, { x: 3 }, null, [4]];
show("map-dbl", () => mixed.map(dbl));
show("map-slen", () => { try { return mixed.map(slen); } catch (e) { return "T:" + (e as any).name; } });
show("map-px", () => { try { return mixed.map(px); } catch (e) { return "T:" + (e as any).name; } });
show("as-number[]", () => (JSON.parse('["a",{},2]') as number[]).map(dbl));
show("as-P[]", () => (JSON.parse('[{"x":"s"},{"y":1},{"x":2}]') as P[]).map(px));
show("chain", () => (JSON.parse('["7",{},2,null]') as number[]).map(dbl).filter((n: number): boolean => n > 3).map((n: number): string => "v" + (n + 1)));
show("chain-2", () => (JSON.parse('[{"x":"s"},{"x":2}]') as P[]).filter((p: P): boolean => p.x > 1).map(px));
show("sort", () => JSON.stringify((JSON.parse('[{"x":"b"},{"x":3},{"x":"a"},{"x":1}]') as P[]).sort(cmp)));
show("reduce", () => (mixed as number[]).reduce((a: number, n: number): number => a + n, 0));
show("forEach", () => { let s = 0; (mixed as number[]).forEach((n: number) => { s += n; }); return s; });
show("find", () => JSON.stringify((mixed as P[]).find((p: P): boolean => p != null && p.x === 3)));
show("from", () => Array.from({ length: 2 }, slen as any));
show("from-iter", () => Array.from(new Set<any>(["ab", 5]), slen));
show("replace", () => "a1b2".replace(/\d/g, dbl as any));
show("reviver", () => JSON.stringify(JSON.parse('{"a":"1","b":2}', ((k: string, v: number): number => v * 2) as any)));
show("map-forEach", () => { let s = ""; new Map<any, any>([["k", 1], [2, "v"]]).forEach((v: number, k: string) => { s += (v + 1) + k.length; }); return s; });
show("flatMap", () => (mixed as string[]).flatMap((s: string): number[] => [s == null ? -1 : s.length]));
show("every", () => (mixed as number[]).every((n: number): boolean => n + 1 > 0));
await Promise.resolve("str" as any).then(dbl).then((v) => console.log("then", v));
await Promise.resolve({ x: "px" } as any).then(px).then((v) => console.log("then-px", v));
await Promise.reject(7).catch(slen as any).then((v) => console.log("catch", v));
await new Promise<void>((r) => setTimeout(((s: string) => { console.log("timeout", s.length); r(); }) as any, 0, 55));
