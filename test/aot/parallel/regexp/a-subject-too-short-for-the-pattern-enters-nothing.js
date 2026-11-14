// A router asks each of its routes about each path, and most routes are longer than the path. A pattern takes its code from the image at the first subject that is long enough for it, so such a pattern stayed without code,
// and each question about a short path entered the run time, which answered at once. The stub now asks whether the subject is too short before it asks whether the pattern has code.
// COUNT: operation:operationAOTRegExpTestBoxed <= 200
// COUNT: operation:operationAOTRegExpTest <= 200
// COUNT: operation:operationAOTRegExpExec <= 200
const atRunTime = text => text.slice(Math.min(0, process.pid));
const routes = ["/users/:user/posts/:post", "/shops/:shop/orders", "/a-long-path/of/many/parts"].map(path => new RegExp("^" + path.replace(/:[a-z]+/g, "([^/]+)") + "(?:/$)?$", "i"));
const literals = [/^\/users\/\d+\/posts$/, /^\/shops\/[a-z]+\/orders$/, /a-plain-text-of-some-length/, /^\u{1F600}{3}-faces$/u];
let hits = 0;
for (let round = 0; round < 2000; round++) {
  for (const route of routes) {
    if (route.test("/text")) hits++;
    if (route.exec("/json") !== null) hits++;
  }
  for (const literal of literals) {
    if (literal.test("/text")) hits++;
    if (literal.exec("/json") !== null) hits++;
  }
}
console.log(hits);

// One character less than the least match, as many, and one more: of one byte and of two, flat, a part of another text, and put together; with code from the image, without a record, plain characters, and with flags.
const lines = [];
const cases = [
  [/^ab+c$/, "abc"],
  [/^ab+c$/i, "ABC"],
  [/abc/, "abc"],
  [/^a.c$/s, "a\nc"],
  [/^\u{1F600}b$/u, "\u{1F600}b"],
  [/^[Ā-ſ]{3}$/, "ĀāĂ"],
  [/^(?:ab){2}(?=c)/, "ababc"],
  [/(?<=ab)c$/, "abc"],
  [/^$/, ""],
  [/^(a)(b)?c$/, "ac"],
  [new RegExp("^" + ["x", "y", "z"].join("") + "$"), "xyz"],
  [new RegExp(atRunTime("^xy+z$")), "xyz"],
  [new RegExp(atRunTime("xyz")), "xyz"],
  [/ab+c/g, "abc"],
  [/ab+c/y, "abc"],
];
for (const [pattern, least] of cases) {
  const subjects = [least.slice(0, -1), least, least + least.slice(-1), least.slice(1), "Ā" + least, least + "Ā"];
  const answers = [];
  for (const subject of subjects) {
    const part = ("<<" + subject + ">>").slice(2, 2 + subject.length);
    const together = subject.slice(0, 1) + atRunTime(subject.slice(1));
    for (const form of [subject, part, together]) {
      pattern.lastIndex = 0;
      const tested = pattern.test(form);
      const last = pattern.lastIndex;
      pattern.lastIndex = 0;
      const found = pattern.exec(form);
      answers.push((tested ? 1 : 0) + "" + last + (found === null ? "-" : found.index + ":" + found.join(",").length));
    }
  }
  lines.push(pattern.source + "/" + pattern.flags + " " + answers.join(" "));
}
// What matched last is what the last match left, whatever was too short since.
/(b+)/.test("abbc");
/^a-long-text-that-is-not-there$/.test("no");
lines.push(RegExp.$1 + " " + RegExp.lastMatch + " " + RegExp.leftContext);
// A lastIndex that is no number is converted, whatever the length of the subject, by a pattern that reads it.
const asked = [];
const sticky = /^a-long-text-that-is-not-there$/y;
sticky.lastIndex = { valueOf() { asked.push("asked"); return 0; } };
lines.push(sticky.test("no") + " " + asked.join() + " " + sticky.lastIndex);
console.log(lines.join("\n"));
