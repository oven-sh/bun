import * as L from "libs";
const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
class Point { x: number; y: number; constructor(x: number = 0, y: number = 0) { this.x = x; this.y = y; } norm(): number { return Math.abs(this.x) + Math.abs(this.y); } plus(o: Point): Point { return new Point(this.x + o.x, this.y + o.y); } get sum(): number { return this.x + this.y; } static origin(): Point { return new Point(); } }
interface State { count: number; name: string; tags: string[]; nested: { on: boolean; n: number } }
const state = (): State => ({ count: 1, name: "s", tags: ["a"], nested: { on: true, n: 2 } });
const p = new Point(1, 2); const c = L.cloneByDescriptors(p);
t("x", () => [c.x, c.norm(), c instanceof Point, c.plus(p).sum, Object.keys(c)]);
const d = L.cloneByDescriptors(state()); t("s", () => [d.count + 1, d.nested.n, d]);
