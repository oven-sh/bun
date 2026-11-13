// These patterns parse, but their quantifiers add up to more than a string can hold, so compiling them fails: every use throws a SyntaxError, however short the subject is.
// Each source is created once.
const uses = [
  ["exec", (re, subject) => re.exec(subject)],
  ["test", (re, subject) => re.test(subject)],
  ["replace", (re, subject) => subject.replace(re, "x")],
  ["match", (re, subject) => subject.match(re)],
  ["search", (re, subject) => subject.search(re)],
  ["split", (re, subject) => subject.split(re)],
];
function report(label, create) {
  let re;
  try {
    re = create();
  } catch (error) {
    console.log(label, "creation threw", error.name + ": " + error.message);
    return;
  }
  for (const subject of ["", "aaa", "b"]) {
    for (const [name, use] of uses) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let result;
        try {
          result = "returned " + JSON.stringify(use(re, subject));
        } catch (error) {
          result = "threw " + error.name + ": " + error.message;
        }
        console.log(label, JSON.stringify(subject), name, attempt, result);
      }
    }
  }
}
report("constant string", () => new RegExp("(a{4294967295})+?1{4294967295}"));
report("folded string", () => RegExp(JSON.parse('"(b{4294967295})+?2{4294967295}"')));
report(
  "run-time string",
  () => new RegExp(["(c{4294967295})", "+?3{4294967295}"].join(process.argv.length > 99 ? "x" : "")),
);
