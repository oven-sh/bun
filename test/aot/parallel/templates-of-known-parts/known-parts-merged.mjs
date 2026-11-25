// Templates and sums whose parts are known at the call: constants handed to copied functions, empty parts, wide characters, numbers, what is no text; results measured, read, compared, kept and used as keys. What is printed is what plain Bun prints.
// STATISTIC: KnownPartsMerged >= 6
const unseen = x => [x][JSON.parse("0")];
const SEPARATOR = "; ";
const log = [];
const say = (...parts) => { log.push(parts.map(p => typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : String(p)).join(" ")); };
const tag = (name, content) => `<${name}>${content ? `<b>${content}</b>` : ""}</${name}>`;
const pair = (key, value) => `${key}=${value}${SEPARATOR}`;
const wide = (a, b) => `${a}日${b}本${a}`;
const sum = (a, b) => "[" + a + "" + b + ", " + a + "]";
function attribute(name, value) { if (!value) return ` ${name}`; return ` ${name}="${value}"`; }
const nested = (a, b) => `${`${a}-${a}`}${b}${`${""}${a}`}`;
const kept = [];
const table = {};
function run(turns, given) {
  let length = 0, text = "", codes = 0;
  for (let i = 0; i < turns; i++) {
    const element = tag("p", i & 1 ? "x" : "");
    length += element.length + tag("", given).length;
    if (element === "<p></p>") codes++;
    text += pair("width", i) + pair("", "");
    codes += wide("a", given).charCodeAt(2) + wide("\ud83d", "\ude00").length;
    table[sum("k", i & 3)] = sum(1, -0) + sum(1.5, given);
    kept.push(attribute("id", given), attribute("checked", ""), nested("n", given), nested(given, "n"), nested("", ""));
    length += sum(NaN, true).length + sum(null, undefined).indexOf(",") + sum(12345678901234567890n, 1e21).length;
  }
  say(length, text, codes);
  return length;
}
for (const given of unseen(["v", "", "\xe9", "日", 0, -0, NaN, 1e21, null, undefined, true, [1, 2], { toString() { return "o"; } }])) {
  say(run(4, given));
  say(kept.splice(0).join("|"), JSON.stringify(table));
}
const joinOf = given => { let n = 0; for (let i = 0; i < 3; i++) n += tag("p", given).length; return n; };
for (const given of unseen([Symbol("s"), Object.create(null)])) {
  try { say(joinOf(given)); } catch (error) { say(error.name); }
  try { say(run(2, given)); } catch (error) { say(error.name); }
}
console.log(log.join("\n"));
