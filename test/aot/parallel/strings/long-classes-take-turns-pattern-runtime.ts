// The parser takes a character class whose text it has parsed before in the same pattern without parsing it again: the last short one, and the last sixteen long ones.
// Here long classes take turns, twenty of them push each other out, two differ in their last character only, one is the beginning of another, one comes negated, one stands under (?i: ) and outside of it,
// and each is followed by another quantifier. The patterns are put together at run time. The output is that of plain Bun.
const given: string = typeof process === "object" ? process.argv.slice(2).join("") : String(Date.now()).slice(0, 0);
function longClass(first: number, count: number, more = ""): string {
  let text = "[";
  for (let i = 0; i < count; i++) text += "\\u" + (first + i * 2).toString(16).padStart(4, "0");
  return text + more + given + "]";
}
const log: string[] = [];
function show(source: string, flags: string, ...subjects: string[]) {
  const pattern = new RegExp(source, flags);
  log.push(source.length + " " + flags + " " + subjects.map(subject => {
    pattern.lastIndex = 0;
    const match = pattern.exec(subject);
    return match ? match.index + ":" + JSON.stringify(match[0]) + ":" + (match.length - 1) : "no";
  }).join(" "));
}
const a = longClass(0x61, 6), b = longClass(0x62, 6), c = longClass(0x41, 6), d = longClass(0x30, 5);
show("^" + a + b + a + b + c + d + a + "$", "", "abcbA0a", "abcbA1a", "bbcbA0a", "acedC8k");
show("^" + a + "+" + b + "*" + a + "?" + b + "{2}" + a + "+?" + b + "*?$", "", "aabbbdd", "acebdfbd", "bd", "abb");
const twenty: string[] = [];
for (let i = 0; i < 20; i++) twenty.push(longClass(0x100 + i * 32, 6, String.fromCharCode(97 + i)));
show("^" + twenty.join("") + twenty.join("") + twenty[0] + twenty[19] + twenty[3] + "$", "", "abcdefghijklmnopqrstabcdefghijklmnopqrstatd", "abcdefghijklmnopqrstabcdefghijklmnopqrstatc", "ĀbcdefghijklmnopqrstĂbcdefghijklmnopqrstatd");
const endsInX = longClass(0x61, 6, "x"), endsInY = longClass(0x61, 6, "y");
show("^" + endsInX + endsInY + endsInX + endsInY + "$", "", "xyxy", "yxyx", "aaaa", "xxxx");
const whole = longClass(0x61, 8), beginning = longClass(0x61, 7);
show("^" + whole + beginning + whole + beginning + "$", "", "oaoa", "oooo", "amom", "aooa");
const negated = "[^" + a.slice(1);
show("^" + a + negated + a + negated + "$", "", "abab", "aaaa", "a1c2", "bbbb");
show("^" + a + "(?i:" + a + a + ")" + a + "$", "", "aAAa", "aaaa", "AAAA", "aACa", "aAaA");
show("^(?:" + a + "|" + b + ")(" + a + ")(?=" + b + ")(?!" + a + ")" + b + "$", "", "aab", "bab", "aaa", "bcd");
show("(" + a + ")\\1" + a, "g", "xxaacxx", "aba", "cce");
show("^[ab][ab][cd][ab][cd][cd]" + a + "[ab]" + a + "[ab]$", "", "abcadcabab", "abcadcaccb", "abcadcabcc");
show("^" + a + "-" + a + "]" + a + "$", "", "a-c]e", "a-c]f");
console.log(log.join("\n"));
