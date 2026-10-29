// A direct eval that gets a text it has had before at the same place runs the code it made the first time. Each place keeps its own code, because the same text means something else among other variables, in another mode or in another kind of code. Every answer is the one that a fresh parse gives.
// The counter is the number of evaluations that found no code: one for each pair of place and text below, and one for each evaluation of a text that is never kept. The comment above each case says what it adds.
// COUNTER: DirectEvalsParsed = 132
module.exports = {};

const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const lines = [];
function say(label, ...values) {
  lines.push(label + ": " + values.map(String).join(" "));
}

// 96: a place keeps the code of 64 texts. Of 80 texts, each evaluated twice, the last 16 are parsed both times. This runs first: the places below must still have room.
function evaluatesManyTexts(text, base) {
  return eval(text);
}
let sumOfManyTexts = 0;
for (let round = 0; round < 2; round++) {
  for (let number = 0; number < 80; number++) sumOfManyTexts += evaluatesManyTexts("base * " + number + " + " + number, round + 1);
}
say("more texts than a place keeps", sumOfManyTexts);

// 1
function repeatsOneText(turns) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) eval("total += turn % 7");
  return total;
}
say("one text", repeatsOneText(10000));

// 2
function alternatesTexts(turns) {
  const texts = ["low += 1", "high += low"];
  let low = 0;
  let high = 0;
  for (let turn = 0; turn < turns; turn++) eval(texts[turn & 1]);
  return [low, high];
}
say("two texts in turn", alternatesTexts(10000));

// 4: one text at four places.
const sharedText = "value = value + step; value";
let value = 100;
let step = 5;
function overLocals(turns) {
  let value = 1;
  const step = 2;
  let last;
  for (let turn = 0; turn < turns; turn++) last = eval(sharedText);
  return [last, value];
}
function overParameters(value, step, turns) {
  let last;
  for (let turn = 0; turn < turns; turn++) last = eval(sharedText);
  return [last, value, arguments[0]];
}
function overConstant(turns) {
  const value = 1;
  const step = 2;
  let refusals = 0;
  for (let turn = 0; turn < turns; turn++) {
    try {
      eval(sharedText);
    } catch (error) {
      if (error instanceof TypeError) refusals++;
    }
  }
  return [refusals, value, step];
}
function overModuleVariables(turns) {
  let last;
  for (let turn = 0; turn < turns; turn++) last = eval(sharedText);
  return last;
}
say("one text over locals", overLocals(1000));
say("one text over parameters", overParameters(10, 3, 1000));
say("one text over a constant", overConstant(1000));
say("one text over module variables", overModuleVariables(1000), value, step);

// 2: one text in sloppy and in strict code. Class code is always strict.
const modeText = "var fresh = typeof fresh; [typeof this, fresh].join()";
function sloppyCaller(text) {
  const answer = eval(text);
  return answer + " " + typeof fresh;
}
class StrictCode {
  static run(text) {
    const answer = eval(text);
    return answer + " " + typeof fresh;
  }
}
const strictCaller = StrictCode.run;
function countAnswers(turns, run) {
  const counts = new Map();
  for (let turn = 0; turn < turns; turn++) {
    const answer = run(turn);
    counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
  return [...counts].map(([answer, count]) => count + " x " + answer).join("; ");
}
say("sloppy", countAnswers(1000, () => sloppyCaller(modeText)));
say("strict", countAnswers(1000, () => strictCaller(modeText)));

// 4: strict code rejects the text each of the three times, and no code is kept for it. Sloppy code parses it once.
const octalText = "010 + step";
function nameOfError(run) {
  try {
    return run();
  } catch (error) {
    return error.name;
  }
}
say("legacy octal, sloppy", countAnswers(3, () => nameOfError(() => sloppyCaller(octalText))));
say("legacy octal, strict", countAnswers(3, () => nameOfError(() => strictCaller(octalText))));

// 1: the text declares a variable and a function in the function that called eval, anew in each call.
const keptHelpers = [];
function declares(seed) {
  const before = typeof injected + " " + typeof helper;
  eval("var injected = seed * 2; function helper() { return injected++; }");
  if (seed % 500 === 0) keptHelpers.push(helper);
  return before + " " + (injected - seed * 2) + " " + (helper() - seed * 2) + " " + (injected - seed * 2);
}
say("declarations", countAnswers(2000, declares));

// 1: what the text declares with let, const and class is gone after each evaluation.
function declaresLexically(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += eval("let local = turn; const twice = local * 2; class Inner { static doubled = twice; } Inner.doubled");
  return [sum, typeof local, typeof twice, typeof Inner];
}
say("lexical declarations", declaresLexically(1000));

// 2: two field initializers.
class Measured {
  static made = 0;
  id = eval("Measured.made += 1");
  twice = eval("this.id * 2");
}
say("field initializers", countAnswers(2000, turn => {
  const measured = new Measured();
  return measured.id - turn + " " + (measured.twice - 2 * turn);
}));

// 3: a function may name `arguments` in the text, and keeps the code. A field initializer may not: it rejects the same text both times.
const argumentsText = "arguments.length + arguments[0]";
function namesArguments() {
  const inner = () => eval(argumentsText);
  return inner();
}
class NamesArguments {
  answer = (() => nameOfError(() => eval(argumentsText)))();
}
say("arguments in a function", countAnswers(1000, turn => namesArguments(turn, 0, 0) - turn));
say("arguments in a field initializer", countAnswers(2, () => new NamesArguments().answer));

// 2: the private name of the text is the one of the class around the place.
const secretText = "this.#secret + other.#secret";
class First {
  #secret;
  constructor(secret) {
    this.#secret = secret;
  }
  sum(other) {
    return eval(secretText);
  }
}
class Second {
  #secret;
  constructor(secret) {
    this.#secret = secret;
  }
  sum(other) {
    return eval(secretText);
  }
}
say("private names", countAnswers(1000, turn => new First(turn).sum(new First(1)) - turn + " " + (new Second(turn).sum(new Second(2)) - turn)));
say("private names of the other class", nameOfError(() => new First(1).sum(new Second(2))), nameOfError(() => new Second(1).sum(new First(2))));

// 2: super is the parent of the object around the place.
const superText = "super.describe() + '!'";
class Parent {
  describe() {
    return "parent";
  }
}
class Child extends Parent {
  describe() {
    return eval(superText);
  }
}
const literal = {
  __proto__: { describe: () => "prototype" },
  describe() {
    return eval(superText);
  },
};
say("super", countAnswers(1000, () => new Child().describe() + " " + literal.describe()));

// 1: this and new.target are those of the call.
function Target(text) {
  return { seen: eval(text) };
}
say("this and new.target", countAnswers(1000, turn => {
  const text = "typeof new.target + ' ' + typeof this.mark";
  return turn & 1 ? new Target(text).seen : Target.call({ mark: 1 }, text).seen;
}));

// 1: the first evaluation ends in the dead zone of the variable.
function readsAroundDeclaration() {
  const read = () => eval("later + 1");
  const early = nameOfError(read);
  let later = 41;
  return [early, read(), read()];
}
say("dead zone", readsAroundDeclaration());

// 1: the object of the with statement changes from call to call.
let member = "module";
function insideWith(object) {
  with (object) {
    return eval("member += '.'; member");
  }
}
say("with", countAnswers(999, turn => insideWith([{ member: "first" }, { other: 0, member: "second" }, {}][turn % 3]).replace(/\.+$/, ".")), member.length);

// 1
function insideCatch(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    try {
      throw turn;
    } catch (thrown) {
      sum += eval("thrown + 1");
    }
  }
  return sum;
}
say("catch parameter", insideCatch(1000));

// 2: the text is a new string each time, a rope until eval reads it. The second text has characters outside Latin-1.
function buildsTexts(turns, left, right) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += eval(left + " * " + right + " + turn");
  return sum;
}
say("texts built anew", buildsTexts(2000, "turn", "3"), buildsTexts(2000, "'ππ'.length", "turn"));

// 1: the text calls the function that evaluates it.
function descends(depth) {
  return eval("depth ? descends(depth - 1) + depth : 0");
}
say("recursion", descends(40), descends(40));

// 3: each evaluation of a tagged template has a template object of its own, so no code is kept.
function tag(strings) {
  return strings;
}
function evaluatesTemplate() {
  return eval("tag`a${1}b`");
}
const templates = [evaluatesTemplate(), evaluatesTemplate(), evaluatesTemplate()];
say("template objects", templates[0] === templates[1], templates[1] === templates[2], templates[0].join("|"));

// 2: an object or a closure that the text makes is new each time.
function makesObjects(seed) {
  return eval("({ seed, read: () => seed })");
}
const madeObjects = [makesObjects(1), makesObjects(2), makesObjects(3)];
say("objects", madeObjects[0] === madeObjects[1], madeObjects[0].read === madeObjects[1].read, madeObjects.map(made => made.seed + made.read()));
function makesCounters(start) {
  return eval("() => start++");
}
const counters = [];
for (let turn = 0; turn < 1000; turn++) counters.push(makesCounters(turn));

// 0: the code is still there after a collection, and so is what earlier evaluations left behind.
collect();
say("closures after a collection", counters[0]() + counters[0](), counters[999]() + counters[999](), keptHelpers.map(helper => helper() + "," + helper()));
say("one text after a collection", repeatsOneText(1000));
say("two texts after a collection", alternatesTexts(1000));
say("one text at four places after a collection", overLocals(10), overParameters(10, 3, 10), overConstant(10), overModuleVariables(10));
say("both modes after a collection", sloppyCaller(modeText), strictCaller(modeText));
say("declarations after a collection", declares(7), declaresLexically(10));
say("classes after a collection", new Measured().twice, namesArguments(5), new First(1).sum(new First(2)), new Second(3).sum(new Second(4)), new Child().describe());
say("built texts after a collection", buildsTexts(10, "turn", "3"), descends(10), insideCatch(10));
collect();
say("kept texts of the full place", evaluatesManyTexts("base * 0 + 0", 5), evaluatesManyTexts("base * 63 + 63", 5));

console.log(lines.join("\n"));
