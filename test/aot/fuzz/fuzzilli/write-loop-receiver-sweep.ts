// Methods that a loop calls by their name on receivers of several classes: how the classes hold the method, times what it does, times the receivers, times how it is called, times what happens on the way, times where the loop stands.
//
//   bun write-loop-receiver-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<holder>--<body>--<receivers>--<call>--<event>--<place>.mjs or .ts
//   bun write-loop-receiver-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// Classes A, B, C (and more) with `v`; `BODY` is the body of the method `step(k)`.
const holders: [name: string, text: string][] = [
  [
    "two",
    "class A {\n  v = 1;\n  step(k) {\n    BODY\n  }\n}\nclass B {\n  v = 0.5;\n  step(k) {\n    return k - 1;\n  }\n}\nclass C extends A {}",
  ],
  [
    "three",
    "class A {\n  v = 1;\n  step(k) {\n    BODY\n  }\n}\nclass B {\n  w = 2;\n  v = 3;\n  step(k) {\n    BODY\n  }\n}\nclass C {\n  v = 7;\n  step(k) {\n    return this.v * k;\n  }\n}",
  ],
  [
    "four",
    "class A {\n  v = 1;\n  step(k) {\n    BODY\n  }\n}\nclass B {\n  v = 2;\n  step() {\n    return 2;\n  }\n}\nclass C {\n  v = 3;\n  step(k) {\n    return k;\n  }\n}\nclass D {\n  v = 4;\n  step(k) {\n    return [k];\n  }\n}",
  ],
  [
    "overridden",
    "class A {\n  v = 1;\n  step(k) {\n    BODY\n  }\n}\nclass B extends A {\n  step(k) {\n    return super.step(k) + 1;\n  }\n}\nclass C extends B {}",
  ],
  [
    "abstract",
    "class A {\n  v = 1;\n  step(k) {\n    return this.part(k);\n  }\n  part(k) {\n    BODY\n  }\n}\nclass B extends A {\n  part(k) {\n    return k * 2;\n  }\n}\nclass C extends A {\n  part() {\n    return this.v;\n  }\n}",
  ],
  [
    "by-function",
    "function A() {\n  this.v = 1;\n}\nA.prototype.step = function (k) {\n  BODY\n};\nfunction B() {\n  this.w = 1;\n  this.v = 2;\n}\nB.prototype.step = function (k) {\n  return k + this.w;\n};\nfunction C() {\n  A.call(this);\n}\nC.prototype = Object.create(A.prototype);",
  ],
  [
    "fields",
    "class A {\n  v = 1;\n  step = k => {\n    BODY\n  };\n}\nclass B {\n  v = 2;\n  step(k) {\n    return k;\n  }\n}\nclass C {\n  v = 3;\n  step = function (k) {\n    return this?.v + k;\n  };\n}",
  ],
  [
    "getter",
    "class A {\n  v = 1;\n  get step() {\n    return k => {\n      BODY\n    };\n  }\n}\nclass B {\n  v = 2;\n  step(k) {\n    return k;\n  }\n}\nclass C extends A {}",
  ],
  [
    "static",
    "class A {\n  v = 1;\n  static v = 9;\n  static step(k) {\n    return k + this.v;\n  }\n  step(k) {\n    BODY\n  }\n}\nclass B extends A {\n  step(k) {\n    return A.step(k);\n  }\n}\nclass C {\n  v = 2;\n  step(k) {\n    return B.step(k);\n  }\n}",
  ],
  [
    "private",
    "class A {\n  v = 1;\n  #hidden = 2;\n  step(k) {\n    this.#hidden += k;\n    return this.#hidden;\n  }\n}\nclass B {\n  v = 2;\n  step(k) {\n    BODY\n  }\n}\nclass C extends A {}",
  ],
  [
    "made-twice",
    "const make = v =>\n  class {\n    v = v;\n    step(k) {\n      BODY\n    }\n  };\nconst A = make(1);\nconst B = make(0.5);\nclass C extends A {}",
  ],
  [
    "by-key",
    'const name = "st" + "ep";\nclass A {\n  v = 1;\n  [name](k) {\n    BODY\n  }\n}\nclass B {\n  v = 2;\n  step(k) {\n    return k;\n  }\n}\nclass C extends B {}',
  ],
  [
    "assigned",
    "class A {\n  v = 1;\n}\nclass B {\n  v = 2;\n}\nObject.assign(A.prototype, {\n  step(k) {\n    BODY\n  },\n});\nB.prototype.step = A.prototype.step;\nclass C extends A {}",
  ],
  [
    "of-a-list",
    "class A extends Array {\n  v = 1;\n  step(k) {\n    BODY\n  }\n}\nclass B extends Map {\n  v = 2;\n  step(k) {\n    this.set(k, k);\n    return this.size;\n  }\n}\nclass C {\n  v = 3;\n  step(k) {\n    return k;\n  }\n}",
  ],
  [
    "generator",
    "class A {\n  v = 1;\n  *step(k) {\n    yield this.v + k;\n  }\n}\nclass B {\n  v = 2;\n  step(k) {\n    BODY\n  }\n}\nclass C extends A {}",
  ],
];
const bodies: [name: string, text: string][] = [
  ["sum", "return this.v + k;"],
  ["written", "this.v += k;\nreturn this.v;"],
  ["itself", "return this;"],
  ["branch", "return k > 1 ? this.v : -k;"],
  ["looped", "let sum = this.v;\nfor (let j = 0; j < k; j++) sum += j;\nreturn sum;"],
  ["missing", "return this.absent ?? k;"],
  ["made", "this.late = k;\nreturn this.late + this.v;"],
  ["thrown", 'if (k === 2) throw new RangeError("k");\nreturn k;'],
  ["text", 'return "s" + this.v + k;'],
  ["record", "return { v: this.v, k };"],
  ["nothing", "this.v = k;"],
  ["double", "return this.v / 2;"],
  ["by-arguments", "return k === undefined ? 0 : +k;"],
  ["large", "return (this.v = Math.imul(this.v + k, 70000));"],
];
const receivers: [name: string, text: string][] = [
  ["two", "[new A(), new B()]"],
  ["three", "[new A(), new B(), new C()]"],
  ["one", "[new A(), new A()]"],
  ["own", "[new A(), { v: 5, step: k => k * 10 }, new B()]"],
  ["shadowed", "[new A(), Object.assign(new B(), { step: k => -k })]"],
  ["missing", "[new A(), new B(), { v: 3 }]"],
  ["nothing", "[new A(), undefined, new B()]"],
  ["number", "[new A(), 3, new B()]"],
  ["bare", "[new B(), Object.create(null)]"],
  ["watched", "[new A(), new Proxy(new B(), {})]"],
  ["heir", "[new C(), Object.create(new A())]"],
  ["moved", "[new A(), Object.setPrototypeOf({ v: 8 }, B.prototype), new C()]"],
  ["frozen", "[new A(), Object.freeze(new B())]"],
  ["class", "[new B(), A, new C()]"],
  ["not-callable", "[new A(), { v: 1, step: 3 }, new B()]"],
  ["accessor", "[new A(), { v: 2, get step() { return k => this.v + k; } }]"],
  ["many", "Array.from({ length: 24 }, (_, at) => (at % 3 === 0 ? new A() : at % 3 === 1 ? new B() : new C()))"],
  ["holes", "[new A(), , new B()]"],
];
// `o` is the receiver, `i` the counter; the value of the call.
const calls: [name: string, text: string][] = [
  ["named", "o.step(i)"],
  ["optional", "o?.step(i)"],
  ["optional-call", "o.step?.(i)"],
  ["both", "o?.step?.(i)"],
  ["by-text", 'o["step"](i)'],
  ["by-key", "o[key](i)"],
  ["by-call", "o.step.call(o, i)"],
  ["by-other", "o.step.call(list[0], i)"],
  ["by-apply", "o.step.apply(o, [i, 1])"],
  ["spread", "o.step(...[i, 2])"],
  ["more", "o.step(i, 1, 2)"],
  ["none", "o.step()"],
  ["twice", "o.step(o.step(i) | 0)"],
  ["of-element", "list[i % list.length].step(i)"],
  ["of-field", "box.o.step(i)"],
  ["bound", "o.step.bind(o)(i)"],
  ["taken", "Reflect.apply(o.step, o, [i])"],
  ["double", "o.step(i + 0.5)"],
  ["text", 'o.step("1")'],
  ["tested", 'typeof o.step === "function" ? o.step(i) : -1'],
  ["sum", "o.step(i) + o.step(i + 1)"],
  ["by-class", "o instanceof A ? o.step(i) : o instanceof B ? o.step(-i) : o.step(9)"],
];
const events: [name: string, text: string][] = [
  ["none", ""],
  ["replaced", "if (i === 2) A.prototype.step = k => k + 100;"],
  ["replaced-second", "if (i === 2)\n  B.prototype.step = function () {\n    return this.v;\n  };"],
  ["deleted", "if (i === 3) delete B.prototype.step;"],
  ["own", "if (i === 1) list[0].step = () => 5;"],
  ["moved", "if (i === 2 && list[1]) Object.setPrototypeOf(list[1], A.prototype);"],
  [
    "accessor",
    "if (i === 2) Object.defineProperty(B.prototype, 'step', { configurable: true, get: () => k => k + 0.25 });",
  ],
  ["exchanged", "if (i === 2) list[0] = new B();"],
  ["grown", "if (i === 2) list.push(new C());"],
  ["reshaped", "if (i === 1 && list[0]) list[0].extra = i;"],
  ["filled", "if (i === 2) Object.defineProperty(A.prototype, 'absent', { value: 40, configurable: true });"],
];
// `o` runs over `list`; `CALL` is the statement.
const places: [name: string, text: string][] = [
  ["of", "let i = 0;\nfor (const o of list) {\n  CALL\n  i++;\n}"],
  ["counted", "for (let i = 0; i < 6; i++) {\n  const o = list[i % list.length];\n  CALL\n}"],
  [
    "nested",
    "for (let turn = 0; turn < 3; turn++)\n  for (let i = 0; i < list.length; i++) {\n    const o = list[i];\n    CALL\n  }",
  ],
  ["callback", "list.forEach((o, i) => {\n  CALL\n});"],
  ["long", "for (let i = 0; i < 150; i++) {\n  const o = list[i & 1];\n  CALL\n}"],
  ["while", "let i = 5;\nwhile (i-- > 0) {\n  const o = list[i % list.length];\n  CALL\n}"],
  ["function", "const one = (o, i) => {\n  CALL\n};\nfor (let i = 0; i < 5; i++) one(list[i % list.length], i);"],
  [
    "tried",
    "for (let i = 0; i < 6; i++) {\n  const o = list[i % list.length];\n  try {\n    CALL\n  } catch (error) {\n    out.push(error.name);\n  }\n}",
  ],
  ["reduced", "list.reduce((i, o) => {\n  CALL\n  return i + 1;\n}, 0);"],
  [
    "breaks",
    "for (let i = 0; ; i++) {\n  if (i > 4) break;\n  const o = list[i % list.length];\n  if (!o) continue;\n  CALL\n}",
  ],
];
const uses: [name: string, text: string][] = [
  ["kept", "out.push(show(VALUE));"],
  ["summed", "sum += VALUE;"],
  ["dropped", "VALUE;"],
  ["last", "last = VALUE;"],
  ["counted", "if (VALUE > 1) sum++;"],
];
const total = holders.length * bodies.length * receivers.length * calls.length * events.length * places.length * uses.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const holder = pick(holders);
  const call = pick(calls);
  const event = pick(events);
  const body = pick(bodies);
  const receiver = pick(receivers);
  const place = pick(places);
  const use = pick(uses);
  const isTyped = cell % 4 === 1;
  const isGiven = cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const called = [event[1], /\bbox\b/.test(call[1]) ? "box.o = o;" : "", use[1].replace("VALUE", () => (use[0] === "kept" || use[0] === "dropped" || use[0] === "last" ? call[1] : `(${call[1]})`))].filter(Boolean).join("\n"); // prettier-ignore
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Array.isArray(value) ? "[" + value.map(show) + "]" : typeof value === "object" && value ? (typeof value.next === "function" ? "g" + show(value.next().value) : value.constructor?.name + JSON.stringify(value)) : typeof value === "function" ? "f" : Object.is(value, -0) ? "-0" : String(value));',
    "const out = [];",
    within(holder[1], "BODY", body[1]),
    ...(/\bbox\b/.test(call[1]) ? ["const box = { o: null };"] : []),
    `function work(list${isTyped ? ": any[]" : ""}${/\bkey\b/.test(call[1]) ? ", key" : ""}) {`,
    "  let sum = 0;",
    "  let last;",
    indent(within(place[1], "CALL", called), "  "),
    "  out.push(show(sum), show(last));",
    "}",
    "for (let round = 0; round < 2; round++) {",
    "  try {",
    isGiven ? `    const given = { list: ${receiver[1]} };\n    work(given.list${/\bkey\b/.test(call[1]) ? ', "step"' : ""});` : `    work(${receiver[1]}${/\bkey\b/.test(call[1]) ? ', "st" + "ep"' : ""});`, // prettier-ignore
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${holder[0]}--${body[0]}--${receiver[0]}--${call[0]}--${event[0]}--${place[0]}--${use[0]}.${isTyped ? "ts" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
