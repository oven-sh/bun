// A generator is made and walked in one function, so the compiler may merge its body into the loop that walks it and never
// make the object. Nothing of the body runs before the first step, the first step runs where it is taken and not where the
// generator was made, a step in a loop goes on where the last one stopped, and a walk that ends early runs the finally
// blocks. Each scene picks a body, a way to make and step the generator, and something that happens between: a variable the
// body reads changes, the step stands under another handler, the object is asked again after the walk or handed to others.
import type { Random } from "./random";

/** Bodies of `function* NAME(n, box)`. Each tells the log what it does. */
const bodies = [
  'log.push("head " + box.x);\n  for (let i = 0; i < n; i++) yield i + box.x;\n  log.push("end");',
  "for (let i = 0; i < n; i++) yield i;",
  'log.push("head");\n  yield box.x;\n  yield box.x;\n  return "returned";',
  'try {\n    for (let i = 0; i < n; i++) yield i;\n  } finally {\n    log.push("finally " + box.x);\n  }',
  'if (box.x > 4) throw new RangeError("at the first step");\n  yield 1;\n  yield 2;',
  "box.x++;\n  yield box.x;\n  box.x++;\n  yield box.x;",
  "let sent = 0;\n  for (let i = 0; i < n; i++) sent = (yield i + sent) ?? 0;",
  'yield* [1, 2];\n  log.push("between");\n  yield* inner(n);',
  'try {\n    yield 1;\n    yield 2;\n  } catch (error) {\n    log.push("caught inside");\n    yield 9;\n  }',
  "const seen = box.x;\n  box = { x: 100 };\n  yield seen;\n  yield box.x;",
  "while (n < 40) yield n++;",
  'log.push("only a head");',
  "yield n;\n  yield arguments.length;",
];

/** Further parameters. Their defaults are evaluated by the call that makes the generator, not by its first step. */
const parameters = [
  "",
  "",
  "",
  ", extra = box.x",
  ", extra = noted(box.x)",
  ", { x: extra } = box",
  ", [extra] = [box.x]",
  ", extra = box.x > 4 ? risky() : 0",
  ", extra = (box.x += 1)",
  ", extra = () => box.x",
];

/** Statements that make and use the generator. MAKE is the call. They push to `out`. */
const uses = [
  "for (const value of MAKE) out.push(value);",
  "for (const value of MAKE) {\n    out.push(value);\n    if (out.length > 2) break;\n  }",
  'for (const value of MAKE) {\n    out.push(value);\n    if (value > 0) return "left " + out.join();\n  }',
  'for (const value of MAKE) {\n    out.push(value);\n    if (out.length > 1) throw new Error("from the loop");\n  }',
  "for (const value of MAKE) {\n    out.push(value);\n    box.x += 10;\n    if (out.length > 4) break;\n  }",
  'const made = MAKE;\n  log.push("made");\n  box.x = 5;\n  for (const value of made) {\n    out.push(value);\n    if (out.length > 3) break;\n  }',
  "const made = MAKE;\n  for (const value of made) {\n    out.push(value);\n    if (out.length > 3) break;\n  }\n  out.push(shown(made.next()));",
  "const made = MAKE;\n  for (const value of made) {\n    out.push(value);\n    if (out.length > 1) break;\n  }\n  for (const value of made) out.push(value);",
  'let made;\n  try {\n    made = MAKE;\n  } catch (error) {\n    log.push("caught where it is made");\n  }\n  box.x = 5;\n  out.push(shown(made.next()));',
  'const made = MAKE;\n  box.x = 5;\n  try {\n    out.push(shown(made.next()));\n  } catch (error) {\n    log.push("caught where it is stepped");\n  }\n  out.push(shown(made.next()));',
  "const made = MAKE;\n  for (let step = 0; step < 3; step++) out.push(shown(made.next(step)));",
  "const made = MAKE;\n  let step = made.next();\n  while (!step.done && out.length < 5) {\n    out.push(step.value);\n    step = made.next();\n  }\n  out.push(shown(step));",
  "out.push(...[...limited(MAKE)]);",
  "const [first, second] = MAKE;\n  out.push(first, second);",
  "const [first] = MAKE;\n  out.push(first);",
  "out.push(Array.from(limited(MAKE)).length);",
  "const made = MAKE;\n  out.push(shown(made.return(7)), shown(made.next()));",
  'const made = MAKE;\n  out.push(shown(made.next()), shown(told(() => made.throw(new Error("thrown in")))), shown(told(() => made.next())));',
  'const made = MAKE;\n  out.push(shown(told(() => made.throw(new Error("before the first step")))), shown(made.next()));',
  "const made = MAKE;\n  out.push(shown(made.next()));\n  others.push(made);\n  unknown();\n  out.push(shown(made.next()));",
  "const one = MAKE;\n  const two = MAKE;\n  out.push(shown(one.next()), shown(two.next()), shown(one.next()), shown(two.next()));",
  "const made = MAKE;\n  out.push(made[Symbol.iterator]() === made, typeof made.next, String(made));",
  "MAKE;\n  out.push(box.x);",
  'for (const value of MAKE) {\n    for (const other of MAKE) {\n      out.push(value + ":" + other);\n      if (out.length > 5) break;\n    }\n    if (out.length > 5) break;\n  }',
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const make = random.pick([
      `gen${scene}(n, box)`,
      `gen${scene}(n, box)`,
      `gen${scene}(noted(n), box)`,
      `gen${scene}(n, box, 1)`,
    ]);
    const rounds = random.pick([1, 1, 3, 200]);
    const more = random.pick(parameters);
    scenes.push(`function* gen${scene}(n, box${more}) {
  ${more && random.chance(0.7) ? 'yield typeof extra === "function" ? extra() : extra;\n  ' : ""}${random.pick(bodies)}
}
function scene${scene}(n) {
  let box = { x: 1 };
  const out = [];
  ${random.pick(uses).replaceAll("MAKE", make)}
  return out.join() + " box " + box.x;
}
{
  let last;
  for (let round = 0; round < ${rounds}; round++) {
    log.length = 0;
    others.length = 0;
    last = noted([${random
      .sample(["0", "1", "2", "3", "6"], 2)
      .map(n => `told(() => scene${scene}(${n}))`)
      .join(", ")}].join(" | ") + " log " + log.join(";"));
  }
  console.log("scene ${scene}", last, counted());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set();
function noted(answer) {
  rounds.add(answer);
  return answer;
}
function counted() {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const log = [];
const others = [];
function unknown() {
  for (const made of others) log.push("elsewhere " + shown(made.next()));
}
function noted(value) {
  log.push("argument");
  return value;
}
function risky() {
  throw new RangeError("from a default");
}
function* inner(n) {
  log.push("inner head");
  yield n;
}
// Ends a walk that would never end.
function* limited(steps) {
  let count = 0;
  for (const value of steps) {
    if (count++ > 5) return;
    yield value;
  }
}
function shown(step) {
  return step !== null && typeof step === "object" && "done" in step ? String(step.value) + (step.done ? "!" : "") : String(step);
}
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
