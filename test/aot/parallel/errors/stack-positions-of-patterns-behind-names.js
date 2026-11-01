// Prints where a stack trace places an object pattern that is given null, behind names that a closure, `eval` or a generator holds and behind names that nobody else sees.
function pass(value) {
  return value;
}
const nothing = null;
const holder = { inner: null };
const key = "number";
const inThisFile = /stack-positions-of-patterns-behind-names/;
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    const places = String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
    console.log(label, "|", error.constructor.name, "|", places.slice(0, -2).join(" "));
  }
}
show("generator, one pattern", () => { function* make({ first }) {} make(nothing); });
show("generator with a body", () => { function* make({ first }) { pass(1); yield first; } make(nothing); });
show("generator, a long name", () => { function* make({ aLongerName }) {} make(nothing); });
show("generator, a renamed member", () => { function* make({ first: renamed }, { second }) {} make({}, nothing); });
show("generator, a name in front", () => { function* make(plain, { first }) {} make(1, nothing); });
show("generator, two names in front", () => { function* make(plain, other, { first }) {} make(1, 2, nothing); });
show("generator, a name behind", () => { function* make({ first }, plain) {} make(nothing); });
show("generator, second pattern", () => { function* make({ first }, { second }) {} make({}, nothing); });
show("generator, second pattern behind two names", () => { function* make({ first, other }, { second }) {} make({}, nothing); });
show("generator, an inner pattern", () => { function* make({ first: { inner } }) {} make({ first: nothing }); });
show("generator, an empty pattern", () => { function* make({}) { pass(1); } make(nothing); });
show("generator, a default inside", () => { function* make({ first = pass(1) }, { second }) {} make({}, nothing); });
show("generator, a default in front", () => { function* make(plain = 1, { second }) {} make(1, nothing); });
show("generator, a default that is null", () => { function* make(plain, { first } = holder.inner) {} make(); });
show("generator, the rest of an object", () => { function* make({ ...rest }, { second }) {} make({}, nothing); });
show("generator, a computed key", () => { function* make({ [key]: first }, { second }) {} make({}, nothing); });
show("generator, a list in front", () => { function* make([first], { second }) {} make([1], nothing); });
show("generator, a list behind", () => { function* make({ first }, [second]) {} make({}, nothing); });
show("generator, a pattern in a list", () => { function* make(plain, [{ first }]) {} make(1, [nothing]); });
show("generator, a pattern in the rest", () => { function* make(plain, ...[{ first }]) {} make(1, nothing); });
show("generator, a pattern in the body", () => { function* make({ first }) { const { second } = nothing; } make({}).next(); });
show("generator method of an object", () => { const object = { *make({ first }) {} }; object.make(nothing); });
show("generator method of a class", () => { class Maker { *make({ first }) {} } new Maker().make(nothing); });
show("static generator method", () => { class Maker { static *make({ first }) { yield first; } } Maker.make(nothing); });
show("asynchronous generator", () => { async function* make({ first }) {} make(nothing); });
show("function, nobody sees the name", () => { function take({ first }, { second }) { return first; } take({}, nothing); });
show("function, nothing in it", () => { function take({ first }) {} take(nothing); });
show("function, a closure reads the first name", () => { function take({ first }, { second }) { return () => first; } take({}, nothing); });
show("function, a closure reads a plain name", () => { function take(plain, { first }) { return () => plain; } take(1, nothing); });
show("function, a closure reads the name of the pattern", () => { function take(plain, { first }) { return () => first; } take(1, nothing); });
show("function, a closure behind a call", () => { function take({ first }) { pass(1); return () => first; } take(nothing); });
show("function with eval", () => { function take({ first }) { eval(""); } take(nothing); });
show("method, nothing in it", () => { const object = { take({ first }) {} }; object.take(nothing); });
show("setter, nothing in it", () => { const object = { set taken({ first }) {} }; object.taken = nothing; });
show("declaration, a closure reads the first name", () => { const { first, second: { inner } } = { first: 1, second: nothing }; pass(() => first); });
show("declaration, nobody sees the name", () => { const { first, second: { inner } } = { first: 1, second: nothing }; pass(first); });
show("declaration, an inner pattern", () => { const { first: { inner } } = { first: nothing }; });
show("assignment, a closure reads the name", () => { let first; ({ first, second: { inner: first } } = { first: 1, second: nothing }); pass(() => first); });
