// An object literal with getters and setters is exported from one file and used through a declared type in another.
import { own, only, pair, make, annotated } from "./files/lib.ts";
declare const console: any;
function line(name: string, f: () => unknown) { try { console.log(name, JSON.stringify(f())); } catch (e: any) { console.log(name, "THREW", e.constructor.name, String(e.message).slice(0, 70)); } }
const read = (p: { g: number }) => p.g;
line("own type, data beside", () => read(own));
line("own type, accessors only", () => read(only));
line("made by a function", () => [read(make(5)), read(make(6))]);
line("annotated over there", () => read(annotated));
line("directly", () => [own.g, own.w, only.g, annotated.g]);
line("a pair", () => { const p: { x: number } = pair; p.x = 4; return [p.x, pair.x]; });
line("assigned", () => { const seen: { g: number; w: number } = own; return seen.g + seen.w; });
line("in an array", () => { const all: { g: number }[] = [own, only, make(7), annotated, { g: 8 }]; return all.map(read); });
