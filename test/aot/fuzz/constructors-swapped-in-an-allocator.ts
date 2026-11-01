// `new allocator.Node(kind)`: the constructor is a member of an object, and the program replaces it at some point, as the
// TypeScript compiler does with Object.assign at its start. The compiler may test for each constructor it saw stored there
// and construct in place. Each scene picks what is stored (functions, classes, one that returns another object, a bound
// function, a proxy, something that is no constructor), how and when it is replaced, how many different ones there are, and
// which fields are stored on the new object afterwards, on which paths.
import type { Random } from "./random";

/** Expressions for a constructor. */
const constructors = [
  "function (kind) {\n    this.kind = kind;\n    this.id = 0;\n  }",
  "function (kind) {\n    this.id = 0;\n    this.kind = kind;\n    this.flags = 1;\n  }",
  "class {\n    constructor(kind) {\n      this.kind = kind;\n    }\n  }",
  'class {\n    id = 0;\n    kind;\n    constructor(kind) {\n      this.kind = kind;\n    }\n    describe() {\n      return "class " + this.kind;\n    }\n  }',
  "function (kind) {\n    return { kind, other: true };\n  }",
  "function (kind) {\n    this.kind = kind;\n    return 5;\n  }",
  'function (kind) {\n    this.kind = kind;\n    this.target = new.target === undefined ? "none" : typeof new.target;\n  }',
  "First.bind(null)",
  "First.bind(null, 9)",
  "new Proxy(First, {})",
  "new Proxy(First, { construct: (target, given) => ({ kind: given[0], trapped: true }) })",
  "class extends First {}",
  "class extends Array {}",
  "Object",
  "Map",
  "kind => ({ kind })",
  "undefined",
  "{ kind: 1 }",
  'function () {\n    throw new RangeError("refuses");\n  }',
];

/** Statements that replace the member. NEXT is the new constructor. */
const swaps = [
  "allocator.Node = NEXT;",
  "Object.assign(allocator, { Node: NEXT });",
  'allocator[key("Node")] = NEXT;',
  'Object.defineProperty(allocator, "Node", { value: NEXT, writable: true, configurable: true });',
  'Object.defineProperty(allocator, "Node", { get: () => NEXT, configurable: true });',
  "replace(allocator, NEXT);",
  "allocator = { Node: NEXT };",
  "delete allocator.Node;\n  Object.setPrototypeOf(allocator, { Node: NEXT });",
];

/** Bodies of `function make(kind)`. */
const makes = [
  "return new allocator.Node(kind);",
  "const made = new allocator.Node(kind);\n  made.id = ++count;\n  return made;",
  "const made = new allocator.Node(kind);\n  if (kind & 1) made.id = ++count;\n  else made.id = -1;\n  return made;",
  "const made = new allocator.Node(kind);\n  if (kind & 1) made.odd = true;\n  made.late = kind;\n  return made;",
  "const Node = allocator.Node;\n  return new Node(kind);",
  "return new (allocator.Node)(kind, 2, 3);",
  "return Reflect.construct(allocator.Node, [kind]);",
  "return new allocator.Node();",
  'return new allocator["Node"](kind);',
  'const made = new allocator.Node(kind);\n  return made instanceof allocator.Node ? made : "not an instance: " + typeof made;',
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const stored = random.sample(constructors, random.between(2, 6));
    const warm = random.pick([1, 3, 300]);
    scenes.push(`{
  let allocator = { Node: First };
  let count = 0;
  function make(kind) {
    ${random.pick(makes).replaceAll("\n", "\n  ")}
  }
  const answers = [];
  const look = () => {
    let last;
    for (let i = 0; i < ${warm}; i++) last = shown(told(() => make(i & 3)));
    answers.push(last);
  };
  look();
  ${stored
    .map(
      next =>
        `told(() => {\n  ${random
          .pick(swaps)
          .replace("NEXT", () => next)
          .replaceAll("\n", "\n  ")}\n  });\n  look();`,
    )
    .join("\n  ")}
  console.log("scene ${scene}", answers.join(" | "), count);
}`);
  }
  return `const key = name => process.argv[9] ?? name;
function First(kind) {
  this.kind = kind;
  this.first = true;
}
First.prototype.describe = function () {
  return "first " + this.kind;
};
function replace(allocator, next) {
  allocator.Node = next;
}
function shown(value) {
  if (value === null || typeof value !== "object") return String(value);
  const names = Object.keys(value).map(name => name + ":" + String(value[name]));
  return (value.constructor?.name || "nameless") + "{" + names.join() + "}" + (typeof value.describe === "function" ? value.describe() : "");
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
