// Rules that a plain function constructs and that a program calls by the name of an interface: `function Made(this: any, ..)` under `new`, handed out `as any`. No object that runs was
// written as a literal of the interface; the one literal that was stands in an arm that ../main.ts never takes.
export interface Payload {
  value: number;
  issues: string[];
}
export interface Definition {
  kind: string;
  limit: number;
}
export interface Internals {
  definition: Definition;
  check(payload: Payload): void;
  when?: (payload: Payload) => boolean;
}
export interface Rule {
  inner: Internals;
}
export type RuleConstructor = new (definition: Definition) => Rule;

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

export const AtLeast = constructorOf("AtLeast", (made, definition) => {
  made.inner.check = payload => {
    if (payload.value < definition.limit) payload.issues.push("under " + definition.limit);
  };
});
export const AtMost = constructorOf("AtMost", (made, definition) => {
  made.inner.check = payload => {
    if (payload.value > definition.limit) payload.issues.push("over " + definition.limit);
  };
});
export const MultipleOf = constructorOf("MultipleOf", (made, definition) => {
  made.inner.when = payload => payload.issues.length === 0;
  made.inner.check = payload => {
    if (payload.value % definition.limit) payload.issues.push("no multiple of " + definition.limit);
  };
});

export function asRule(rule: Rule | ((payload: Payload) => void)): Rule {
  return typeof rule === "function" ? { inner: { definition: { kind: "custom", limit: 0 }, check: rule } } : rule;
}

export function run(payload: Payload, rules: Rule[]): Payload {
  for (const rule of rules) {
    if (rule.inner.when && !rule.inner.when(payload)) continue;
    const before = payload.issues.length;
    rule.inner.check(payload);
    if (payload.issues.length !== before && rule.inner.definition.kind === "last") break;
  }
  return payload;
}
