// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has. Every loop stands in a function that is called several times.
const box: any = {}; (globalThis as any).box = box;
const units = (text: string) => Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16)).join(".");
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \((evaluating|near) .*\)$/, "")); } };
function pieces(name: string) { const seen: string[] = []; for (const piece of box[name]) seen.push(units(piece)); return seen.join(" "); }
box.text = "ab😀cd";
function first(name: string) { for (const piece of box[name]) return units(piece); return "none"; }
function until(name: string, stop: string) { const seen: string[] = []; for (const piece of box[name]) { if (piece === stop) break; seen.push(piece); } return seen.join("|"); }
function skipping(name: string) { const seen: string[] = []; for (const piece of box[name]) { if (piece === "b") continue; seen.push(units(piece)); } return seen.join(" "); }
function throwing(name: string) { const seen: string[] = []; try { for (const piece of box[name]) { seen.push(piece); if (piece === "b") throw new Error("at b"); } } catch (error) { seen.push(String(error)); } finally { seen.push("finally"); } return seen.join("|"); }
function nested(name: string) { let pairs = 0; outer: for (const a of box[name]) { for (const b of box[name]) { if (a === b) continue outer; if (b === "d") break outer; pairs++; } } return pairs; }
function closures(name: string) { const made: (() => string)[] = []; for (const piece of box[name]) made.push(() => units(piece)); return made.map(one => one()).join(" "); }
function changed(name: string) { const seen: string[] = []; for (const piece of box[name]) { seen.push(piece); box[name] = "another text"; } const now = box[name]; box[name] = "ab😀cd"; return seen.length + " " + now; }
function* suspended(name: string): Generator<string, void, unknown> { for (const piece of box[name]) { const sent = yield units(piece); if (sent) yield "sent " + sent; } }
async function awaits(name: string) { const seen: string[] = []; for (const piece of box[name]) { await null; seen.push(units(piece)); try { await Promise.reject(new Error("no")); } catch {} } return seen.join(" "); }
for (let turn = 0; turn < 3; turn++) {
  say(first("text"), until("text", "c"), until("text", "never"), skipping("text"), throwing("text"), nested("text"), closures("text"), changed("text"));
  box.empty = ""; say(first("empty"), until("empty", "a"), nested("empty"));
  const it = suspended("text"); say(it.next().value, it.next("x").value, it.next().value, [...it]); const early = suspended("text"); early.next(); say(early.return(undefined as never), early.next());
  say(await awaits("text"), (await Promise.all([awaits("text"), awaits("text")])).length);
  const [a, b, c = "none", ...rest] = box.text; say(units(a), units(b), units(c), rest.map(units)); const [only, missing = "default"] = "x" as any; say(only, missing);
  let total = 0; for (let round = 0; round < 2000; round++) for (const piece of box.text) total += piece.length; say(total);
}
