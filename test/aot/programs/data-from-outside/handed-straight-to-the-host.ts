// An argument or an options literal that is handed straight to a function of the host is not held to the types of the declaration: the host validates and coerces for itself.
interface Inner { type: "chrome" | "other"; stderr?: string }
interface Options { fatal?: boolean; dir?: string; count?: number; backend?: Inner; list?: number[]; on?(n: number): number }
declare function hostTakes(options?: Options, more?: string): string;
declare class HostClass { constructor(label: string, options?: Options); said: string; take(options: Options): string }
declare const hostObject: { take(options: Options): string; held: Options | undefined };
const show = (v: unknown) => JSON.stringify(v, (_, x) => (x === undefined ? "undefined" : typeof x === "function" ? "function" : typeof x === "bigint" ? x + "n" : x));
(globalThis as any).hostTakes = function (options: unknown, more: unknown) { return show([options, more]); };
(globalThis as any).HostClass = class { said; constructor(label: unknown, options: unknown) { this.said = show([label, options]); } take(options: unknown) { return show(options); } };
(globalThis as any).hostObject = { take(options: unknown) { return show(options); }, held: undefined };
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + (typeof r === "string" ? r : show(r))); };
const falsy: any[] = [0, "", null, undefined, NaN, 0n];
for (const value of falsy) row("a member of another kind, " + String(value), () => hostTakes({ fatal: value }));
row("a constant of another kind, through any", () => hostTakes({ dir: 123 as any }));
// @ts-expect-error
row("a constant of another kind, behind @ts-expect-error", () => hostTakes({ dir: 123 }));
row("below", () => hostTakes({ backend: { type: "chrome", stderr: 123 as any } }));
row("in an array", () => hostTakes({ list: [1, "2" as any, null as any] }));
row("new", () => new HostClass("l", { count: "3" as any }).said);
row("a method", () => new HostClass("l").take({ count: "3" as any }));
row("a method of an object of the host", () => hostObject.take({ fatal: 1 as any }));
row("the second argument", () => hostTakes({}, 5 as any));
row("the argument itself of another kind", () => [hostTakes(5 as any), hostTakes("s" as any), hostTakes(null as any), hostTakes([] as any)]);
row("an object of another look, through any", () => hostTakes({ other: 1 } as any));
row("one of two", () => hostTakes(falsy.length > 99 ? { fatal: true } : { fatal: "no" as any }));
row("a callback inside", () => hostTakes({ on(n) { return n + 1; }, count: 1 }));
row("as the type says", () => hostTakes({ fatal: true, dir: "d", count: 1, backend: { type: "other" }, list: [1] }, "more"));
row("key order and extra members", () => hostTakes({ count: 1, fatal: false, ...({ extra: 1 } as object) }));
row("stored onto the host", () => { hostObject.held = { count: "7" as any }; return show(hostObject.held); });
const kept: Options = { fatal: true, count: 2 };
function countOf(o: Options) { return o.count; }
row("one that typed code holds too", () => [hostTakes(kept), countOf(kept)]);
