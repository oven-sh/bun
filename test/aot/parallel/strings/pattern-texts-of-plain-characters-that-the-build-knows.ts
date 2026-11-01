// A pattern of plain characters needs no code. Its text still has to be parsed to find that out, and the run time does that twice where the image says nothing about the text.
// Where the build knows such a text the pattern is in the image like a literal's: several callers of a function that puts it together, with `new` and without, both arms of a condition,
// the words of a list in a loop and in a callback, a text whose special characters are escaped.
// The last pattern is out of a text that only the run knows: it alone is counted, and parsed.
// COUNTER: RegExpsCreatedWithoutRecord = 1
// COUNTER: RegExpPatternsParsed = 2
function opening(name: string): RegExp {
  return new RegExp("<" + name + ">");
}
function closing(name: string, each: boolean): RegExp {
  return RegExp(`</${name}>`, each ? "g" : undefined);
}
function marker(kind: string): string {
  if (kind.length > 4) return `@${kind}:`;
  return `#${kind}`;
}
function escapeText(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const page = "<b>bold</b> and <i>slanted</i>, <b>again</b> @notice: 1.5 (a+b) #todo <i>";
const wide = "→ " + page;
console.log(opening("b").exec(page)?.index, opening("i").exec(wide)?.index, opening("u").test(page));
console.log(page.replace(closing("b", true), "|"), page.replace(closing("b", false), "|").length, (wide.match(closing("i", true)) ?? []).length);
console.log(new RegExp(marker("notice")).exec(page)?.index, new RegExp(marker("todo")).exec(wide)?.index, new RegExp(marker("none")).test(page));

const WORDS = ["bold", "slanted", "missing"];
const inALoop: string[] = [];
for (const word of WORDS) inALoop.push(word + ":" + new RegExp(word).test(page));
console.log(inALoop.join(), WORDS.map(word => wide.search(new RegExp(word, "g"))).join());

const escaped = [new RegExp(escapeText("1.5")), new RegExp(escapeText("(a+b)"), "g")];
console.log(escaped.map(expression => expression.source + " " + expression.flags + " " + expression.exec(page)?.index + " " + expression.test("1x5 ab")).join(" | "));

const again = closing("b", true);
const places: number[] = [];
while (again.test(page)) places.push(again.lastIndex);
console.log(places.join(), again.lastIndex, again.source, String(again));

const given = [..."niaga"].reverse().join("");
const fromTheRun = new RegExp(given);
console.log(fromTheRun.source, fromTheRun.exec(page)?.index);
