import { normalize, dropCount, dropByLiteralKey, reflectDrop } from "tinyparams";
const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
type Options = { message: string; abort: boolean }
const shown = (r: { error?: () => string; abort?: boolean }) => Object.keys(r).join() + " " + r.error?.() + " " + r.abort
function made(message: string): Options { return { message, abort: true } }
const kept: Options = { message: "kept", abort: false }
t("a literal as the argument", () => shown(normalize({ message: "inline", abort: true })))
t("an annotated constant", () => shown(normalize(kept)))
t("what a typed helper returns", () => shown(normalize(made("helper"))))
t("a spread of a typed record", () => shown(normalize({ ...made("spread") })))
t("the keys afterwards", () => Object.keys(kept).join() + " " + ("message" in kept) + " " + JSON.stringify(kept))
t("stored again by typed code", () => { kept.message = "again"; return kept.message + " " + Object.keys(kept).join() })
type Counted = { count: number; name: string }
const counted: Counted = { count: 2.5, name: "n" }
t("a number", () => { const before = counted.count + 1; dropCount(counted); return before + " " + Object.keys(counted).join() + " " + ("count" in counted) + " " + counted.name })
t("a number, stored again", () => { counted.count = 4.5; return counted.count * 2 + " " + Object.keys(counted).join() })
type Labeled = { label: string; on: boolean }
const labeled: Labeled = { label: "l", on: true }
t("by a key that is a literal", () => { dropByLiteralKey(labeled); return Object.keys(labeled).join() + " " + labeled.on })
type Flagged = { flag: boolean; id: number }
const flagged: Flagged = { flag: true, id: 7 }
t("Reflect.deleteProperty", () => { reflectDrop(flagged); return Object.keys(flagged).join() + " " + flagged.id + " " + ("flag" in flagged) })
let total = 0
for (let i = 0; i < 1000; i++) { const o: Options = { message: "m" + i, abort: i % 2 === 0 }; total += o.message.length + (o.abort ? 1 : 0) }
t("objects that nobody deletes from", () => total)
