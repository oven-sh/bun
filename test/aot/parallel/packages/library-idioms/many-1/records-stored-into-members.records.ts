import { setInner, pushItem, setList } from "tinyset";
const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
const inferred = { id: 1, label: "l", inner: { n: 1.5 }, items: [{ n: 1 }] }
interface Inner { n: number }
interface State { id: number; label: string; inner: Inner; items: Inner[] }
const annotated: State = { id: 2, label: "a", inner: { n: 2.5 }, items: [{ n: 2 }] }
function made(): State { return { id: 3, label: "m", inner: { n: 3.5 }, items: [] } }
t("inferred, a record is stored", () => { setInner(inferred, 4.5); return inferred.inner.n + 1 })
t("annotated, a record is stored", () => { setInner(annotated, 5.5); return annotated.inner.n + 1 })
t("made by a helper", () => { const s = made(); setInner(s, 6.5); return s.inner.n + 1 })
t("inferred, pushed to its array", () => { pushItem(inferred, 9); return inferred.items.map(i => i.n).join() })
t("annotated, pushed to its array", () => { pushItem(annotated, 9); return annotated.items.map(i => i.n).join() })
t("inferred, its array replaced", () => { setList(inferred); return inferred.items.map(i => i.n).join() })
t("annotated, its array replaced", () => { setList(annotated); return annotated.items.map(i => i.n).join() })
t("the stored object is the same object", () => { const held: { n: number }[] = []; const keep = { id: 4, inner: { n: 0 } }; setInner(keep, 1.25); held.push(keep.inner); keep.inner.n = 2.25; return held[0].n + " " + (held[0] === keep.inner) + " " + JSON.stringify(keep) })
t("stored twice", () => { const twice = { inner: { n: 0 } }; setInner(twice, 1); const first = twice.inner; setInner(twice, 2); return first.n + " " + twice.inner.n + " " + (first === twice.inner) })
