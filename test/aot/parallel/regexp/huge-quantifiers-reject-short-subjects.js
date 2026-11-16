// These patterns have quantifiers near 2 ** 32 and still compile. They run in the interpreter and match nothing that fits in memory.
const patterns = [
  "a{4294967295}",
  "(?:a{4294967295}){2}",
  "(?=a{4294967295})1{4294967295}",
  "a{2147483648}",
  "(a{2147483647})b",
];
for (const source of patterns) {
  for (const re of [new RegExp(source), new RegExp(source, "g")]) {
    for (const subject of ["", "aaa", "a".repeat(100)]) {
      console.log(
        source,
        re.flags,
        subject.length,
        re.exec(subject),
        re.test(subject),
        subject.replace(re, "x").length,
        re.lastIndex,
      );
    }
  }
}
console.log(
  /a{4294967295}/.exec("aaa"),
  /(?:a{4294967295}){2}/.test("aaa"),
  "aaa".replace(/(?=a{4294967295})1{4294967295}/, "x"),
);
