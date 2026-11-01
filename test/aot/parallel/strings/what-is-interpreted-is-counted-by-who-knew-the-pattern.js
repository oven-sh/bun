// A pattern is byte-compiled before it is interpreted, once, whichever way its matches are made: so the count of that step, by who knew the pattern, says for a whole run what was left to the
// interpreter. Here the literals and the texts that the build works out have their code, and the one text that only the run knows is the one pattern that is byte-compiled.
// COUNTER: RegExpLiteralsCompiledToBytecode = 0
// COUNTER: RegExpPredictedTextsCompiledToBytecode = 0
// COUNTER: RegExpImageCodeGaveUp = 0
// COUNTER: RegExpsCompiledToBytecode = 1
// COUNTER: RegExpsCreatedWithoutRecord = 1
// COUNTER: RegExpMatchesInterpreted >= 1
const literals = [/^[a-z]+-\d+$/, /(\w+)@(\w+)\.com/i, /\bcolou?r\b/g, /^(?:ab|cd)+$/u];
const texts = ["^[0-9a-f]{4}$", "^v\\d+\\.\\d+$", "(?:left|right)-(?:top|bottom)"];
const predicted = texts.map(text => new RegExp(text));
const ofTheRun = new RegExp("^" + "x".repeat(process.argv.length > 99 ? 3 : 2) + String(process.argv.length > 99 ? 1 : "") + "[yz]+$");
const subjects = ["abc-12", "me@here.com", "a color", "abcd", "00ff", "v1.20", "left-top", "xxyz", "─ colour ─", "nothing"];
const answers = [];
for (const tested of [...literals, ...predicted, ofTheRun]) {
  let line = "";
  for (const subject of subjects) {
    tested.lastIndex = 0;
    line += tested.test(subject) ? "1" : "0";
  }
  answers.push(line);
}
console.log(answers.join(" "));
