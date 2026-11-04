// Nothing is known of what the loops iterate over: it is read out of an object that unseen code has. Every loop stands in a function that is called several times.
const box: any = {}; (globalThis as any).box = box;
const units = (text: string) => Array.from({ length: text.length }, (_, index) => text.charCodeAt(index).toString(16)).join(".");
const say = (...parts: unknown[]) => console.log(parts.map(part => typeof part === "string" ? part : JSON.stringify(part) ?? "undefined").join(" "));
const attempt = (name: string, run: () => unknown) => { try { say(name, run()); } catch (error) { say(name, "THROWS", String(error).replace(/ \((evaluating|near) .*\)$/, "")); } };
function pieces(name: string) { const seen: string[] = []; for (const piece of box[name]) seen.push(units(piece)); return seen.join(" "); }
const lead = "\ud83d", trail = "\ude00";
const texts: [string, string][] = [["empty", ""], ["one", "a"], ["ascii", "hello, world"], ["a zero", "a\0b"], ["latin", "éÿ\u0080"], ["wide", "世界€"], ["a pair", lead + trail], ["pairs", "a" + lead + trail + "b" + lead + trail], ["a lead at the end", "a" + lead], ["a lead alone", lead], ["a trail alone", trail], ["a trail first", trail + lead], ["two leads", lead + lead + trail], ["two trails", lead + trail + trail], ["a lead and a letter", lead + "a"], ["the edges", "퟿\ud800􏰀\udfff"], ["a lead and the last trail", "􏿿"], ["combining", "é"], ["joined", "👨‍👩"]];
for (let turn = 0; turn < 3; turn++) for (const [name, text] of texts) {
  box.text = text; const byLoop = pieces("text");
  say(name + ":", byLoop, byLoop === [...text].map(units).join(" "), byLoop === Array.from(text, units).join(" "));
}
for (let turn = 0; turn < 3; turn++) {
  box.rope = "ab" + String(turn) + "cd".repeat(3) + lead + trail; say(pieces("rope"));
  box.part = "0123456789".substring(3, 7); say(pieces("part")); box.cut = ("x" + lead + trail + "y").slice(1, 2); say(pieces("cut")); box.number = String(12.5e3); say(pieces("number")); box.template = `${turn}-${"z"}`; say(pieces("template"));
  box.json = JSON.parse("\"p\\ud83d\\ude00q\""); say(pieces("json")); box.joined = ["a", "b"].join(lead) + trail; say(pieces("joined")); box.upper = "straße".toUpperCase(); say(pieces("upper"));
  box.long = ("ab" + lead + trail).repeat(20000); let count = 0, length = 0; for (const piece of box.long) { count++; length += piece.length; } say(count, length, box.long.length);
  const kinds = new Set<string>(); for (const piece of box.long) kinds.add(typeof piece + piece.length); say([...kinds].sort());
}
