// Flags: --aot-testing=CheckWalkAtRunTime
// `exec` and `test` are names of regular expressions. The stub that serves a call by such a name looks at the receiver only inside the body that it emits: until then it has answered nothing.
// Under the word that checks the walk nothing may be held against the built-in's method there: a URLPattern, an object of a class of the program and a plain object have methods of their own under the names.
// Beside them stand a regular expression as made, one with a method of its own, and one of a class below that overrides both.
const unseen = (0, eval)("(x) => x");
class Matcher { exec(text) { return text.length > 3 ? [text] : null; } test(text) { return text.length > 3; } }
class Loud extends RegExp { exec(text) { const found = super.exec(text); return found && [found[0].toUpperCase()]; } test(text) { return !super.test(text); } }
const own = /b/; own.exec = () => ["own"]; own.test = () => false;
function ask(one, text) { let out = ""; for (let i = 0; i < 10; i++) { const found = one.exec(text); out = (found === null ? "null" : typeof found) + " " + one.test(text); } return out; }
for (const one of unseen([new URLPattern({ pathname: "/books/:id" }), new Matcher(), { exec: () => null, test: () => true }, /oo/, own, new Loud("oo")])) console.log(ask(one, "https://shop.example.test/books/12"));
