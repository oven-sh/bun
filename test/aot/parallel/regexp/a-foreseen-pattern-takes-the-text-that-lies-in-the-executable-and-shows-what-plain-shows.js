// A pattern whose text the build has foreseen takes the text that lies in the executable, whether the program hands a rope or a flat text. What the program can see of the pattern stays what plain Bun shows: its source, its flags, what it matches, the error of a text that is no pattern, and that two patterns of one text are two objects.
// COUNTER: RegExpTextsTakenOutOfImage >= 30
// COUNTER: RegExpsCreatedWithoutRecord = 6
const out = [];
function join(parts) {
  let text = "";
  for (const part of parts) text = text + part;
  return text;
}
function make(parts, flags) {
  return new RegExp(join(parts), flags);
}
function makePlain(parts) {
  return new RegExp(join(parts));
}
const word = "[a-z]+";
const kept = [];
for (let i = 0; i < 12; i++) kept.push(makePlain(["^", word, "-", String(i), "(?:", word, ")?", "$"]));
out.push(kept.map((pattern, i) => pattern.test("ab-" + i + "cd") && !pattern.test("ab-" + (i + 1) + "!")).join(""));
out.push(kept[3].source, kept[11].source.length, kept[0].flags === "", kept[4].lastIndex);

const sameTextOtherFlags = ["g", "i", "gi", "m", "s", "u", "y"].map(function (flags) {
  switch (flags) {
    case "g": return new RegExp(join(["a", "+", "b"]), "g");
    case "i": return new RegExp(join(["a", "+", "b"]), "i");
    case "gi": return new RegExp(join(["a", "+", "b"]), "gi");
    case "m": return new RegExp(join(["a", "+", "b"]), "m");
    case "s": return new RegExp(join(["a", "+", "b"]), "s");
    case "u": return new RegExp(join(["a", "+", "b"]), "u");
    default: return new RegExp(join(["a", "+", "b"]), "y");
  }
});
out.push(sameTextOtherFlags.map(pattern => pattern.flags + ":" + pattern.test("xAAB") + ":" + pattern.test("aab") + ":" + pattern.lastIndex).join(","));

const wideFiber = "中^q[0-9]+";
const narrowOutOfWide = makePlain([wideFiber.slice(1), "z", "$"]);
const narrowTwin = makePlain(["^q", "[0-9]+", "z$"]);
out.push(narrowOutOfWide.source === narrowTwin.source, narrowOutOfWide.test("q12z"), narrowOutOfWide !== narrowTwin, narrowOutOfWide.source);

const wide = makePlain(["^", "中文", "+", "😀", "?$"]);
out.push(wide.test("中文文"), wide.source.length, wide.source.charCodeAt(1), wide.source.charCodeAt(4));

const longText = "prefix-of-a-long-text-out-of-which-a-piece-is-cut-(?:x|y)+-and-the-rest";
const cut = makePlain(["^", longText.substring(50, 58), "$"]);
out.push(cut.source, cut.test("xyyx"), cut.test("z"));

const flat = join(["^", "f", "l", "a", "t", "[0-9]", "$"]);
out.push(flat.charCodeAt(2), flat.length);
const ofFlat = new RegExp(flat);
out.push(ofFlat.source === flat, ofFlat.test("flat7"), flat.indexOf("[0"));

const pieces = [];
for (let i = 0; i < 400; i++) pieces.push("(?:k" + (i % 10) + "|[a-f]{1,2})");
const long = makePlain(pieces);
out.push(long.source.length, long.source.slice(4790, 4810), long.test("k0".repeat(400)), long.test("zz"));

const slashes = makePlain(["a/", "b", "\n", "c", "[/]"]);
out.push(JSON.stringify(slashes.source), String(slashes).length, slashes.test("a/b\nc/"));

const empty = makePlain(["", ""]);
out.push(empty.source, empty.test(""), String(empty));

for (const parts of [["(", "a"], ["a", "{2,1}"], ["[", "b-a", "]"], ["\\"]]) {
  try {
    out.push(makePlain(parts).source);
  } catch (error) {
    out.push(error.name + ": " + error.message);
  }
}

const one = makePlain(["tw", "ice", "+"]);
const other = makePlain(["tw", "ice", "+"]);
one.mark = 1;
out.push(one !== other, other.mark, one.source === other.source);
const sticky = new RegExp(join(["n", "+"]), "g");
const stickyTwin = new RegExp(join(["n", "+"]), "g");
sticky.exec("nnn n");
out.push(sticky.lastIndex, stickyTwin.lastIndex);

const named = makePlain(["(?<year>", "[0-9]{4})", "-(?<month>", "[0-9]{2})"]);
const found = named.exec("on 2026-11 we");
out.push(found.groups.year, found.groups.month, found.index, Object.keys(found.groups).join());

const ofTheRun = makePlain(["^r", String(process.argv.length), "x", "+$"]);
out.push(ofTheRun.test("r" + process.argv.length + "xx"), ofTheRun.source.length);
const ofTheRunFlat = "^s" + process.argv.length + "y$";
out.push(ofTheRunFlat.length, new RegExp(ofTheRunFlat).test("s" + process.argv.length + "y"));

const text = join(["st", "ays", "[0-9]"]);
const ofText = new RegExp(text);
out.push(text + "!", text.length, ofText.source + "?", text === ofText.source, text.toUpperCase());
console.log(out.join("\n"));
