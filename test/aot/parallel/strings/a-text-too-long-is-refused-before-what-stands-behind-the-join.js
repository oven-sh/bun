// `a + b + c` may be joined in one step. A text of more than 2^31 - 1 characters is refused, and what the program can see goes by where: a call that is written behind the join that fails does not run.
let big = "0123456789abcdef";
for (let i = 0; i < 26; i++) big += big;
const seen = [];
function note(what) {
  seen.push("ran " + what);
  return what;
}
function attempt(name, make) {
  try {
    seen.push(name + ": " + make(big, "x", 7).length);
  } catch (error) {
    seen.push(name + ": " + error.constructor.name);
  }
}
attempt("a call behind the join that fails", (text, piece) => text + text + note("the call") + piece);
attempt("a call in front of the join that fails", (text, piece) => text + note("the call") + text + piece);
attempt("three parts", (text, piece) => text + text + piece);
attempt("five parts", (text, piece, number) => piece + text + number + text + piece);
attempt("the row on the right", (text, piece, number) => text + (piece + number + text));
attempt("parts that fit", (text, piece, number) => text + piece + number + piece);
attempt("a template", (text, piece) => `${text}${note("the first")}${text}${note("the second")}${piece}`);
attempt("a key", (text, piece) => String({}[text + text + piece]));
attempt("a key that fits", (text, piece, number) => String({}[piece + ":" + number]));
attempt("an object among the parts", (text, piece) => text + { toString: () => note("toString") } + text + piece);
console.log(seen.join("\n"));
