// s.replace(/[class]+/g, "constant"): global patterns that are one character class, repeated or not, alone and in chains. Each is checked against a loop that walks the string with a predicate, and RegExp's legacy static properties against the same pattern given to replace through a variable that is used twice. Patterns that are not of that form stand beside them.
const report: string[] = [];
let wrong = 0;
const legacy = RegExp as unknown as Record<string, string>;
function left(): string {
  return [legacy.lastMatch, legacy.input, legacy.leftContext, legacy.rightContext].join("│");
}
function byHand(text: string, isMember: (code: number) => boolean, inserted: string, joinsRuns: boolean): string {
  let out = "";
  let wasMember = false;
  for (let i = 0; i < text.length; i++) {
    const member = isMember(text.charCodeAt(i));
    if (!member) out += text[i];
    else if (!joinsRuns || !wasMember) out += inserted;
    wasMember = member;
  }
  return out;
}
const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102);
const isBlank = (c: number) => (c >= 9 && c <= 13) || c === 32 || c === 160 || c === 0xfeff || c === 0x2003;
const isWordly = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || c === 95 || (c >= 97 && c <= 122);
const isVowel = (c: number) => "aeiou".includes(String.fromCharCode(c));

const hexRuns = /[0-9a-f]+/g;
const cases: [string, (text: string) => string, (text: string) => string][] = [
  ["hex runs", text => text.replace(hexRuns, "H"), text => byHand(text, isHex, "H", true)],
  ["blank runs", text => text.replace(/\s+/g, "·"), text => byHand(text, isBlank, "·", true)],
  ["each blank", text => text.replace(/\s/g, ""), text => byHand(text, isBlank, "", false)],
  ["not wordly", text => text.replace(/\W+/g, "_"), text => byHand(text, c => !isWordly(c), "_", true)],
  ["wordly", text => text.replace(/\w+/g, "word"), text => byHand(text, isWordly, "word", true)],
  ["vowels", text => text.replace(/[aeiou]/g, "()"), text => byHand(text, isVowel, "()", false)],
  ["not vowels", text => text.replace(/[^aeiou]+/g, "-"), text => byHand(text, c => !isVowel(c), "-", true)],
  ["one letter", text => text.replace(/l+/g, "L"), text => byHand(text, c => c === 108, "L", true)],
  ["all but line ends", text => text.replace(/.+/g, "line"), text => byHand(text, c => c !== 10 && c !== 13 && c !== 0x2028 && c !== 0x2029, "line", true)],
  ["then another", text => text.replace(/[0-9a-f]+/g, "<H>").replace(/\s+/g, "<S>"), text => byHand(byHand(text, isHex, "<H>", true), isBlank, "<S>", true)],
  ["a gap ahead of runs", text => text.replace(/l/g, "").replace(/o+/g, "0"), text => byHand(byHand(text, c => c === 108, "", false), c => c === 111, "0", true)],
  ["classes that overlap", text => text.replace(/[a-h]+/g, "{1}").replace(/[e-p]+/g, "{2}").replace(/\d/g, "n"), text => byHand(byHand(byHand(text, c => c >= 97 && c <= 104, "{1}", true), c => c >= 101 && c <= 112, "{2}", true), c => c >= 48 && c <= 57, "n", false)],
];
const texts = ["", "plain", "f", "cafe babe 2026", "hello  world\t\tfolloow\n\nlines  ", "A1-b2_C3 d4!", "olé   olé 99", "世界 12 ab   cd", "e".repeat(75) + "X" + "7".repeat(75), "lollol oollo"];
for (let turn = 0; turn < 3; turn++)
  for (const [name, replaced, expected] of cases)
    for (const text of texts) {
      const made = replaced(text);
      if (made !== expected(text)) {
        wrong++;
        report.push("WRONG " + name + " " + JSON.stringify(text));
      }
    }

function throughAVariable(text: string, pattern: RegExp, inserted: string): string {
  return pattern.global ? text.replace(pattern, inserted) : text;
}
for (const text of texts) {
  /^mark$/.test("mark");
  const direct = text.replace(/[0-9a-f]+/g, "H");
  const after = left();
  /^mark$/.test("mark");
  if (direct !== throughAVariable(text, /[0-9a-f]+/g, "H") || after !== left()) wrong++;
  if (text.length < 20) report.push(direct + " " + after);
}
function otherForms(text: string): string {
  return [text.replace(/[0-9]*/g, "#"), text.replace(/[0-9]+?/g, "#"), text.replace(/[0-9]{2}/g, "#"), text.replace(/([0-9])+/g, "#"), text.replace(/[0-9]+$/g, "#"), text.replace(/[0-9]+|y/g, "#"), text.replace(/[0-9]+/, "#"), text.replace(/[x-z]+/gi, "#"), text.replace(/[0-9]+/g, "<$&>"), text.replace(/\by/g, "#"), text.replace(/[\d-]+/g, "#"), text.replace(/[-y]+/g, "#")].join(" ");
}
report.push(otherForms("2026-10-17 xYz y12"), String(hexRuns.lastIndex), "wrong " + wrong);
console.log(report.join("\n"));
