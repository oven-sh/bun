// An element read from a variable that is annotated with a type from a declaration file: the object belongs to the embedder, and so do its contents, whatever the index signature says. A cast that the program writes behind such a read is tested like any cast.
import type { Counts, Headers } from "./host";
const given: any = { ":status": 200, "x-list": ["a"], "content-type": 5, "x-s": "s" };
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = f(); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + JSON.stringify(r)); };
const kind = (v: unknown) => typeof v + " " + JSON.stringify(v);
let held: Headers = {};
function keep(headers: Headers) { held = headers; }
keep(given);
const key = [":status"][0];
row("a written key", () => [kind(held[":status"]), kind(held["x-list"]), kind(held["x-s"]), kind(held["none"])]);
row("a computed key", () => kind(held[key]));
row("behind casts", () => [kind(held[":status"] as unknown as number), kind(held[key] as string)]);
row("a declared name", () => [kind(held["content-type"]), kind(held["content-type"] as unknown as number)]);
row("a parameter", () => ((headers: Headers) => kind(headers[":status"]))(given));
row("one that the program made", () => { const own: Headers = { a: "b" }; own.c = "d"; return [kind(own["a"]), kind(own.c), own["a"]!.length, Object.keys(own)]; });
row("numbers", () => { const counts: Counts = given; return [kind(counts["x-s"]), kind(counts[":status"]), (counts[":status"] as number) + 1]; });
interface Mine { [name: string]: number }
row("an index signature of the program's own stays a fact", () => { const mine: Mine = { a: 1 }; mine.b = 2; return [mine["a"] + mine["b"], kind(mine["none"])]; });
