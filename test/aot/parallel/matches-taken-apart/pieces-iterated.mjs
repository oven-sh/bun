// Loops over the pieces of split() with a separator that is written: read, kept, left by break, continue, return, throw and a label; one in another, in generators and async functions; pieces that are empty, texts without the separator, ropes, slices and wide texts. Beside them: a limit, an empty separator, a pattern, a list that is kept, and a separator that is not written. What is printed is what plain Bun prints.
// STATISTIC: SplitIterationsInlined >= 10
const unseen = x => [x][JSON.parse("0")];
const log = [];
const show = p => (typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : Array.isArray(p) ? `[${Array.from(p, show).join()}]` : String(p));
const say = (...parts) => log.push(parts.map(show).join(" "));
const read = given => { const text = String(given); let n = 0, out = ""; for (const line of text.split("\n")) { if (line.length === 0) { n++; continue; } n += line.length; out += line[0] + line.charCodeAt(line.length - 1); } return out + n; };
const kept = given => { const text = String(given); const all = []; let last; for (const part of text.split(", ")) { all.push(part); last = part; } say(all.length, last); return all; };
const left = given => { const text = String(given); let n = 0; outer: for (let turn = 0; turn < 3; turn++) { for (const part of text.split(",")) { n++; if (part === "x") continue outer; if (part === "stop") break outer; if (n > 9) return part; } } return n; };
const inner = given => { const text = String(given); let out = 0; for (const line of text.split("\n")) { let columns = 0; for (const cell of line.split(",")) { columns++; out += cell === "" ? 100 : cell.length; } out += columns * 10; } return out; };
const thrown = given => { const text = String(given); let n = 0; try { for (const part of text.split("\n")) { n++; if (part.includes("x")) throw part; } } catch (error) { return "caught " + error; } finally { say("finally", n); } return n; };
function* yielded(given) { const text = String(given); for (const part of text.split("\n")) { const sent = yield part; if (sent) say("sent", sent, part); } }
const awaited = async given => { const text = String(given); let out = ""; for (const part of text.split(",")) { await null; out += part + ";"; } return out; };
const changed = given => { let text = String(given), n = 0; for (const part of text.split("\n")) { text = part + "\nmore"; n += text.length; } return n; };
const long = given => { const text = String(given); let n = 0; for (const part of text.split("=>")) n = n * 3 + part.length; for (const part of text.split("\u65e5")) n += part.length; for (const part of text.split("aa")) n += part.length * 7; return n; };
const others = given => {
  const text = String(given);
  let n = 0;
  for (const part of text.split("\n", 2)) n += part.length + 1;
  for (const part of text.split("")) n += part.length;
  for (const part of text.split(/,|\n/)) n += part.length + 5;
  for (const part of text.split(unseen(","))) n += part.length * 2;
  for (const part of text.split()) n += part.length;
  for (const part of text.split(undefined)) n += part.length;
  const list = text.split(",");
  for (const part of list) { if (list.length < 9) list.push("added"); n += part.length; }
  for (const [first] of text.split("\n")) n += first === undefined ? 1 : 2;
  say([...text.split("\n")].length, text.split(",").map(x => x.length));
  return n;
};
for (const text of unseen(["", "\n", "a,b\nc,,d\n", "one", "x,y", "stop, me, now", "\u65e5a\n\u00e9,b\u65e5", "aaaaa=>aa=>", "l1\r\nl2\n\nl4", ",".repeat(20) + "\n" + "z".repeat(40)])) {
  for (const given of [text, text.slice(1), unseen("p,\n") + text, (text + text).slice(1, 30)]) {
    for (const run of [read, kept, left, inner, thrown, changed, long, others]) { try { say(run.name, run(given)); } catch (error) { say(error.name); } }
    const steps = yielded(given);
    say(steps.next().value, steps.next("one").value, [...yielded(given)].length, steps.return(5).value);
    say(await awaited(given));
  }
}
console.log(log.length);
console.log(log.join("\n"));
