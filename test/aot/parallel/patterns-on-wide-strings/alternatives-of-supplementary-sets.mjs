// STATISTIC: BitParallelRegExpsCompiled >= 12
// Alternatives that are sequences of as many sets of supplementary characters are matched together. The first alternative at the first place wins, as in any other pattern.
const list = match => match && [match.index, ...match, match.groups ? JSON.stringify(match.groups) : ""];
const patterns = {
  flush: /([\u{1f0a1}-\u{1f0ae}]{5})|([\u{1f0b1}-\u{1f0be}]{5})|([\u{1f0c1}-\u{1f0ce}]{5})/u,
  kinds: new RegExp("(?:[\u{1f0a1}\u{1f0b1}\u{1f0d1}\u{1f0c1}]{2,4})|(?:[\u{1f0ae}\u{1f0be}\u{1f0de}\u{1f0ce}]{2,4})|(?:[\u{1f0a7}\u{1f0b7}]{2,4})", "u"),
  manyKinds: new RegExp(Array.from("123456789abd", digit => `(?:[\\u{1f0a${digit}}\\u{1f0b${digit}}\\u{1f0c${digit}}]{2,4})`).join("|"), "u"),
  runs: /[\u{1f0a1}\u{1f0b1}][\u{1f0a2}\u{1f0b2}]|[\u{1f0a2}\u{1f0b2}][\u{1f0a3}\u{1f0b3}]|([\u{1f0a3}\u{1f0b3}])[\u{1f0a4}\u{1f0b4}]/u,
  firstWins: /([\u{1f0a1}\u{1f0a2}])([\u{1f0a2}])|([\u{1f0a1}])([\u{1f0a2}\u{1f0a3}])/u,
  sharedBeginning: /\u{1f0a1}\u{1f0a2}\u{1f0a3}|\u{1f0a1}\u{1f0a2}\u{1f0a4}|\u{1f0a1}(\u{1f0a5})\u{1f0a6}|\u{1f0a2}\u{1f0a2}\u{1f0a2}/u,
  one: /[\u{1f600}-\u{1f64f}]/gu,
  plus: /[\u{1f600}-\u{1f64f}]+/gu,
  bounded: /[\u{1f0a1}-\u{1f0a4}]{2,7}/gu,
  named: /(?<low>[\u{1f0a1}-\u{1f0a4}])(?<high>[\u{1f0a8}-\u{1f0ae}])/dgu,
  sets: /[\u{1f0a1}-\u{1f0a4}\u{1f0b1}]{2}|[\u{1f0c1}-\u{1f0c4}]{2}/v,
  nested: /((?<all>(\u{1f0a1}[\u{1f0a2}-\u{1f0a4}]))\u{1f0a5})/u,
  folded: /[\u{10400}-\u{10404}]{2}/iu,
  // Not of this form: text in front, lengths that differ, planes that differ, an end.
  behindText: /a[\u{1f0a1}-\u{1f0a4}]{2}/u,
  lengths: /[\u{1f0a1}-\u{1f0a4}]{2}|[\u{1f0b1}-\u{1f0b4}]{3}/u,
  planes: /[\u{1f0a1}\u{20000}]{2}/u,
  atEnd: /[\u{1f0a1}-\u{1f0a4}]{2}$/u,
  sticky: /[\u{1f0a1}-\u{1f0a4}]{2}/uy,
  mixed: /[\u{1f0a1}-\u{1f0a4}a]{2}/u,
};
const card = number => String.fromCodePoint(0x1f0a0 + number);
const subjects = ["", "a", "\ud83c", "\udca1", "\ud83c🂡", "\udca1\udca2", "\u{1f0a1}", "\u{1f0a1}\ud83c", "\ud83c\u{1f0a1}\u{1f0a2}", "a\u{1f0a1}\u{1f0a2}b", "\u{1f0a1}a\u{1f0a2}", "\u{1f600}\u{1f64f}\u{1f650}\u{1f600}", "\u{10400}\u{10428}\u{1042c}", "а\u{1f0a1}\u{1f0a1}\u{1f0b1}\u{1f0c1}\u{1f0d1}\u{1f0a1}", "\u{20000}\u{1f0a1}\u{20000}", "\u{1f0a1}\u{1f0a2}\u{1f0a4}\u{1f0ae}\u{1f0a3}\u{1f0b1}", "\u{1f0c1}\u{1f0b1}\u{1f0b2}\u{1f0be}\u{1f0b3}\u{1f0b9}", "\u{1f0b1}\u{1f0a1}\u{1f0a3}\u{1f0a5}\u{1f0a6}", "\u{1f0a1}\u{1f0a5}\u{1f0a6}", "\u{1f0a2}\u{1f0a2}\u{1f0a2}\u{1f0ae}"];
let seed = 5;
const random = limit => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % limit;
for (let i = 0; i < 90; i++) {
  let text = "";
  for (let length = random(9); length > 0; length--) text += random(11) ? card(16 * random(4) + 1 + random(i % 3 ? 6 : 14)) : ["\ud83c", "\udca3", "a", "\u{1f5ff}", "а"][random(5)];
  subjects.push(text, text.slice(1), ("x" + text + "y").slice(1, -1));
}
for (const [name, pattern] of Object.entries(patterns)) {
  let answers = 0;
  const lines = [];
  for (const subject of subjects) {
    pattern.lastIndex = 0;
    const row = [list(subject.match(new RegExp(pattern.source, pattern.flags.replace("g", "")))), list(pattern.exec(subject)), pattern.lastIndex, pattern.test(subject), subject.search(pattern), subject.replace(pattern, (...all) => all.length), subject.split(pattern).length];
    for (let from = 0; from <= subject.length; from++) {
      pattern.lastIndex = from;
      row.push(list(pattern.exec(subject)), pattern.lastIndex);
    }
    pattern.lastIndex = 0;
    const text = JSON.stringify(row);
    for (let i = 0; i < text.length; i++) answers = (Math.imul(answers, 31) + text.charCodeAt(i)) | 0;
    if (lines.length < 3 && row[0]) lines.push(text);
  }
  console.log(name, answers, lines.join(" "));
}
