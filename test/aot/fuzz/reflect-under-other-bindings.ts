// `Reflect.construct(T, list)` where `Reflect` is not the global but a parameter, a local variable, an import or a member.
// What is called goes by the binding, whatever its name: the compiler may test the callee against the built-in and construct
// in place, and must make an ordinary call of anything else. Each scene picks the binding's name and what it holds (the real
// object, a copy, an object below it, a proxy, a look-alike with members of its own, nothing), the member that is called and
// its arguments, some of them wrong, and calls it often with one holder and then with another.
import type { Random } from "./random";

/** Expressions for what the binding holds. */
const holders = [
  "Reflect",
  "Reflect",
  "Reflect",
  "{ ...Reflect }",
  "Object.create(Reflect)",
  "new Proxy(Reflect, {})",
  'new Proxy(Reflect, { get: (target, name) => (log.push("get " + String(name)), target[name]) })',
  '{ construct: (target, list) => "own construct " + list.length, apply: () => "own apply", get: () => "own get", has: () => "own has", ownKeys: () => ["own"], set: () => "own set", defineProperty: () => "own define", getPrototypeOf: () => "own parent" }',
  "{ construct: Reflect.apply, apply: Reflect.construct, get: Reflect.has, has: Reflect.get }",
  '{ construct: function () {\n      return this === holder ? "this is the holder" : "another this";\n    } }',
  "{}",
  "null",
  "{ construct: 5 }",
  '{ get construct() {\n      log.push("getter");\n      return Reflect.construct;\n    } }',
];

/** Calls on the binding NAME. */
const calls = [
  "NAME.construct(Thing, [1, 2])",
  "NAME.construct(Thing, [1, 2])",
  "NAME.construct(Thing, [])",
  "NAME.construct(Thing, [1], Other)",
  "NAME.construct(Thing, [1], Thing)",
  "NAME.construct(Thing, { length: 1, 0: 7 })",
  "NAME.construct(Thing)",
  "NAME.construct(Thing, null)",
  "NAME.construct(() => 1, [])",
  "NAME.construct(5, [])",
  "NAME.construct(Thing, [1], () => 1)",
  "NAME.construct(Old, [3])",
  "NAME.construct(Array, [3])",
  "NAME.construct(Below, [4])",
  "NAME.construct(Thing, [...list])",
  "NAME.construct(...[Thing, [1]])",
  'NAME["construct"](Thing, [1])',
  "NAME?.construct?.(Thing, [1])",
  "(0, NAME.construct)(Thing, [1])",
  "NAME.apply(sum, null, [1, 2])",
  "NAME.apply(sum, null, list)",
  'NAME.get({ a: 1 }, "a")',
  'NAME.has({ a: 1 }, "a")',
  "NAME.ownKeys({ a: 1, b: 2 })",
  'NAME.set(target, "a", 5)',
  "NAME.getPrototypeOf(new Thing(1)) === Thing.prototype",
];

/** How the binding comes about. BODY returns the answer. HOLDER is the expression above. */
const bindings = [
  "function ask(NAME) {\n    return CALL;\n  }\n  const run = holder => ask(holder);",
  "function ask(NAME) {\n    return CALL;\n  }\n  const run = holder => ask(holder);",
  "const run = holder => {\n    const NAME = holder;\n    return CALL;\n  };",
  "const run = holder => {\n    let NAME = Reflect;\n    NAME = holder;\n    return CALL;\n  };",
  "const run = holder => (({ NAME }) => CALL)({ NAME: holder });",
  "function ask(NAME = Reflect) {\n    return CALL;\n  }\n  const run = holder => ask(holder);",
  "const box = { NAME: null };\n  const run = holder => {\n    box.NAME = holder;\n    return CALL_ON_BOX;\n  };",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const name = random.pick(["Reflect", "Reflect", "Reflect", "R", "reflect", "Object"]);
    const call = random.pick(calls);
    const binding = random
      .pick(bindings)
      .replaceAll("CALL_ON_BOX", call.replaceAll("NAME", "box.NAME"))
      .replaceAll("CALL", call)
      .replaceAll("NAME", name);
    const first = random.pick(holders.slice(0, 4));
    const others = random.sample(holders, random.between(1, 3));
    scenes.push(`{
  ${binding}
  const answers = [];
  for (const make of [() => (${first}), ${others.map(other => `() => (${other})`).join(", ")}, () => (${first})]) {
    let last = "";
    for (let i = 0; i < ${random.pick([1, 3, 300])}; i++) {
      holder = make();
      last = noted(told(() => shown(run(holder))));
    }
    answers.push(last + " " + counted());
  }
  console.log("scene ${scene}", answers.join(" | "), "log", log.length, log.splice(0).slice(0, 3).join());
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
const list = [1, 2];
const target = { a: 1 };
let holder;
class Thing {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.made = new.target === Thing ? "for itself" : typeof new.target;
  }
}
class Below extends Thing {}
function Other() {}
Other.prototype.other = true;
function Old(a) {
  this.a = a;
}
const sum = (a, b) => a + b;
function shown(value) {
  if (value === null || typeof value !== "object") return String(value);
  return (Object.getPrototypeOf(value)?.constructor?.name ?? "none") + " " + JSON.stringify(value) + (value.other ? " other" : "");
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
