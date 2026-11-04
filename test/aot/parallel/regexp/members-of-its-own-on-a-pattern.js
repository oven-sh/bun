// Every method that matches asks the pattern for `exec`, and the methods of strings ask it for a symbol. A pattern with a member of its own answers with that, and so does one of a class below RegExp.
const log = [];
function ownExec(text) {
  const re = /a/;
  re.exec = function (s) { log.push("own exec " + s); return null; };
  return [re.test(text), text.replace(re, "-"), text.match(re), text.search(re), text.split(re).length];
}
function ownExecDefined(text) {
  const re = /a/g;
  Object.defineProperty(re, "exec", { value: () => (log.push("defined exec"), null) });
  return [re.test(text), text.replace(re, "-")];
}
function ownSymbols(text) {
  const re = /a/g;
  re[Symbol.match] = s => "own match " + s;
  re[Symbol.replace] = (s, by) => "own replace " + s + by;
  re[Symbol.search] = s => "own search " + s;
  re[Symbol.split] = s => "own split " + s;
  re[Symbol.matchAll] = s => "own matchAll " + s;
  return [text.match(re), text.replace(re, "-"), text.search(re), text.split(re), text.matchAll(re), text.replaceAll(re, "+")];
}
function noPattern(text) {
  const re = /a/;
  re[Symbol.match] = false;
  return [text.startsWith(re), text.includes(re), text.endsWith(re)];
}
// The other way round, `flags` that say "g" on a pattern that is not global, `replace` never ends, by the language: the pattern matches at the same place for ever.
function ownFlags(text) {
  const re = /a/g;
  Object.defineProperty(re, "flags", { value: "" });
  Object.defineProperty(re, "global", { value: false });
  const answers = [(text + text).replace(re, "-")];
  for (const ask of [() => text.replaceAll(re, "+"), () => [...text.matchAll(re)].length]) {
    try { answers.push(ask()); } catch (error) { answers.push(error.name); }
  }
  return answers;
}
function ownTest(text) {
  const re = /a/;
  re.test = () => "own test";
  return re.test(text);
}
function otherPrototype(text) {
  const re = /a/;
  Object.setPrototypeOf(re, { test: () => "test from above", exec: () => "exec from above" });
  let asked;
  try { asked = RegExp.prototype.test.call(re, text); } catch (error) { asked = error.name; }
  return [re.test(text), re.exec(text), asked];
}
class Logged extends RegExp {
  exec(s) { log.push("Logged.exec " + s); return super.exec(s); }
  [Symbol.replace](s, by) { log.push("Logged.replace"); return super[Symbol.replace](s, by); }
  [Symbol.match](s) { log.push("Logged.match"); return super[Symbol.match](s); }
  get flags() { log.push("Logged.flags"); return super.flags; }
}
function below(text) {
  const re = new Logged("a", "g");
  return [re.test(text), re.lastIndex, text.replace(re, "-"), text.match(re).length, re instanceof RegExp, re.constructor === Logged];
}
class Never extends RegExp {
  exec() { return null; }
}
function never(text) {
  return [new Never("a").test(text), text.replace(new Never("a"), "-"), text.split(new Never("a")).length, text.search(new Never("a"))];
}
function frozen(text) {
  const answers = [];
  for (const make of [() => Object.freeze(/a/g).test(text), () => Object.freeze(/a/).test(text), () => text.replace(Object.freeze(/a/g), "-"), () => text.match(Object.freeze(/a/y))]) {
    try { answers.push(make()); } catch (error) { answers.push(error.name); }
  }
  return answers;
}
function compiledAnew(text) {
  const re = /a/;
  const first = re.test(text);
  re.compile("b", "g");
  return [first, re.test(text), re.source, re.flags, re.lastIndex];
}
for (const ask of [ownExec, ownExecDefined, ownSymbols, noPattern, ownFlags, ownTest, otherPrototype, below, never, frozen, compiledAnew]) {
  console.log(ask.name, JSON.stringify(ask("xab")), JSON.stringify(ask("/a/")));
  console.log(log.splice(0).join(" | "));
}
