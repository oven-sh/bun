// Rules that a plain function constructs and that the program calls by the name of an interface: `function Made(this: any, ..)` under `new`, handed out `as any`. No object that runs here was
// written as a literal of the interface; the one literal that was stands in an arm that no call of this program takes.
interface Payload {
  value: number;
  issues: string[];
}
interface Definition {
  kind: string;
  limit: number;
}
interface Internals {
  definition: Definition;
  check(payload: Payload): void;
  when?: (payload: Payload) => boolean;
}
interface Rule {
  inner: Internals;
}
type RuleConstructor = new (definition: Definition) => Rule;

function constructorOf(name: string, initialize: (made: Rule, definition: Definition) => void): RuleConstructor {
  function Inner(this: any, definition: Definition) {
    this.definition = definition;
  }
  function Made(this: any, definition: Definition) {
    Object.defineProperty(this, "inner", { value: new (Inner as any)(definition), enumerable: false });
    initialize(this, definition);
  }
  Object.defineProperty(Made, "name", { value: name });
  return Made as any;
}

const AtLeast = constructorOf("AtLeast", (made, definition) => {
  made.inner.check = payload => {
    if (payload.value < definition.limit) payload.issues.push("under " + definition.limit);
  };
});
const AtMost = constructorOf("AtMost", (made, definition) => {
  made.inner.check = payload => {
    if (payload.value > definition.limit) payload.issues.push("over " + definition.limit);
  };
});
const MultipleOf = constructorOf("MultipleOf", (made, definition) => {
  made.inner.when = payload => payload.issues.length === 0;
  made.inner.check = payload => {
    if (payload.value % definition.limit) payload.issues.push("no multiple of " + definition.limit);
  };
});

function asRule(rule: Rule | ((payload: Payload) => void)): Rule {
  return typeof rule === "function" ? { inner: { definition: { kind: "custom", limit: 0 }, check: rule } } : rule;
}

function run(payload: Payload, rules: Rule[]): Payload {
  for (const rule of rules) {
    if (rule.inner.when && !rule.inner.when(payload)) continue;
    const before = payload.issues.length;
    rule.inner.check(payload);
    if (payload.issues.length !== before && rule.inner.definition.kind === "last") break;
  }
  return payload;
}

const rules = [
  new AtLeast({ kind: "least", limit: 3 }),
  new AtMost({ kind: "most", limit: 900 }),
  new MultipleOf({ kind: "multiple", limit: 3 }),
  new AtLeast({ kind: "least", limit: 1 }),
  new AtMost({ kind: "last", limit: 990 }),
].map(asRule);

let turn = 0,
  issues = 0;
for (const turns of process.argv.slice(3)) {
  for (let left = Number(turns); left > 0; left--) {
    turn++;
    for (let value = 0; value < 40; value++) issues += run({ value: (value * 29 + turn) % 1000, issues: [] }, rules).issues.length;
  }
  process.kill(process.pid, 0);
}
console.log(turn, issues);
