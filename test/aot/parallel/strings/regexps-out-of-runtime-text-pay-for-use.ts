// Patterns out of text that the build cannot know. One that is never matched is checked for its syntax and nothing else, however short it is. One that is matched is compiled once,
// at its first match. Whatever they cost, they answer what they answer in plain Bun.
// Parsed: 12 for their syntax at creation (the one that does not parse too), 5 of them once more there because they have named groups or are plain characters, 4 at a first match.
// COUNTER: RegExpsCreatedWithoutRecord = 12
// COUNTER: RegExpPatternsParsed = 21
// COUNTER: RegExpsCompiledToBytecode = 4
const given: string = typeof process === "object" ? process.argv.slice(2).join("") : String(Date.now()).slice(0, 0);
const neverMatched = new RegExp("^(?:a|b)+" + given + "$");
const matchedTwice = new RegExp("(\\d+)-(\\d+)" + given);
const matchedOften = new RegExp("^\\s*([a-z]+)\\s*=\\s*(\\d+|\"[^\"]*\")\\s*;?" + given + "$", "i");
const named = new RegExp("(?<year>\\d{4})-(?<month>\\d\\d)" + given);
const plain = new RegExp("needle" + given);
const spaces = new RegExp("^\\s+" + given);

let failure = "";
try {
  new RegExp("(" + given);
} catch (error) {
  failure = (error as Error).name;
}

console.log(neverMatched.source, neverMatched.flags, neverMatched.lastIndex, failure);
console.log(matchedTwice.exec("from 10-20 on")?.slice(1).join(), matchedTwice.test("none"));
let found = 0;
let last = "";
for (let i = 0; i < 200; i++) {
  const match = matchedOften.exec(i % 3 ? `  Key${"x".repeat(i % 7)} = ${i} ;` : `key = "v${i}"`);
  if (match) {
    found++;
    last = match[1] + ":" + match[2];
  }
}
console.log(found, last, matchedOften.test("no assignment"));
console.log(named.exec("on 2026-10-20")?.groups?.month, plain.test("a needle"), "a needle".replace(plain, "pin"), "   indented".replace(spaces, ""));
console.log([new RegExp("a/b" + given), new RegExp("[/]\\/" + given), new RegExp("a\nb" + given), new RegExp(" " + given), new RegExp(given)].map(pattern => pattern.source).join(" | "));
