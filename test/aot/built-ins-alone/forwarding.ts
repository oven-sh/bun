import { lines, ordinals, type Program } from "./program";

interface Forwarder {
  name: string;
  rows: string[];
  setup?: string[];
  before?(callee: string): string[];
  run(callee: string, self: string, passed: string[]): string;
  finish?: string[];
  self: "passed" | "none" | string;
  answer: "value" | "promise" | "none";
  later?: boolean;
  most?: number;
}

const list = (passed: string[]) => passed.join(", ");
const after = (first: string, passed: string[]) => [first, ...passed].join(", ");
const arrayLike = (passed: string[]) =>
  `{ length: ${passed.length}${passed.map((value, index) => `, ${index}: ${value}`).join("")} }`;

const events = ['import { EventEmitter } from "node:events";', "const emitter = new EventEmitter();"];
const asyncHooks = ['import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";'];

const forwarders: Forwarder[] = [
  {
    name: "function-call",
    rows: ["Function.prototype.call"],
    run: (callee, self, passed) => `${callee}.call(${after(self, passed)})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "function-apply",
    rows: ["Function.prototype.apply"],
    run: (callee, self, passed) => `${callee}.apply(${self}, [${list(passed)}])`,
    self: "passed",
    answer: "value",
  },
  {
    name: "function-apply-with-an-array-like-object",
    rows: ["Function.prototype.apply"],
    run: (callee, self, passed) => `${callee}.apply(${self}, ${arrayLike(passed)})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "function-apply-with-an-arguments-object",
    rows: ["Function.prototype.apply"],
    setup: ["let receiver;"],
    before: callee => ["function relay() {", `  return ${callee}.apply(receiver, arguments);`, "}"],
    run: (callee, self, passed) => `((receiver = ${self}), relay(${list(passed)}))`,
    self: "passed",
    answer: "value",
  },
  {
    name: "function-bind-with-every-argument",
    rows: ["Function.prototype.bind"],
    run: (callee, self, passed) => `${callee}.bind(${after(self, passed)})()`,
    self: "passed",
    answer: "value",
  },
  {
    name: "function-bind-with-the-first-two-arguments",
    rows: ["Function.prototype.bind"],
    run: (callee, self, passed) => `${callee}.bind(${after(self, passed.slice(0, 2))})(${list(passed.slice(2))})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "function-bind-without-arguments",
    rows: ["Function.prototype.bind"],
    run: (callee, self, passed) => `${callee}.bind(${self})(${list(passed)})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "function-bind-of-a-bound-function",
    rows: ["Function.prototype.bind"],
    run: (callee, self, passed) =>
      `${callee}.bind(${after(self, passed.slice(0, 1))}).bind(${after("null", passed.slice(1, 3))})(${list(passed.slice(3))})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "reflect-apply",
    rows: ["Reflect.apply"],
    run: (callee, self, passed) => `Reflect.apply(${callee}, ${self}, [${list(passed)}])`,
    self: "passed",
    answer: "value",
  },
  {
    name: "reflect-apply-with-an-array-like-object",
    rows: ["Reflect.apply"],
    run: (callee, self, passed) => `Reflect.apply(${callee}, ${self}, ${arrayLike(passed)})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "call-called-by-call",
    rows: ["Function.prototype.call"],
    run: (callee, self, passed) => `Function.prototype.call.call(${after(callee, [self, ...passed])})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "call-called-by-apply",
    rows: ["Function.prototype.call", "Function.prototype.apply"],
    run: (callee, self, passed) => `Function.prototype.call.apply(${callee}, [${after(self, passed)}])`,
    self: "passed",
    answer: "value",
  },
  {
    name: "apply-called-by-call",
    rows: ["Function.prototype.call", "Function.prototype.apply"],
    run: (callee, self, passed) => `Function.prototype.apply.call(${callee}, ${self}, [${list(passed)}])`,
    self: "passed",
    answer: "value",
  },
  {
    name: "call-called-by-reflect-apply",
    rows: ["Function.prototype.call", "Reflect.apply"],
    run: (callee, self, passed) => `Reflect.apply(Function.prototype.call, ${callee}, [${after(self, passed)}])`,
    self: "passed",
    answer: "value",
  },
  {
    name: "call-bound-to-its-callee",
    rows: ["Function.prototype.call", "Function.prototype.bind"],
    run: (callee, self, passed) => `Function.prototype.call.bind(${callee})(${after(self, passed)})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "bind-called-by-call",
    rows: ["Function.prototype.call", "Function.prototype.bind"],
    run: (callee, self, passed) => `Function.prototype.bind.call(${after(callee, [self, ...passed])})()`,
    self: "passed",
    answer: "value",
  },
  {
    name: "a-proxy-without-traps",
    rows: ["Proxy"],
    run: (callee, self, passed) => `new Proxy(${callee}, {})(${list(passed)})`,
    self: "none",
    answer: "value",
  },
  {
    name: "a-proxy-whose-apply-trap-uses-reflect-apply",
    rows: ["Proxy", "Reflect.apply"],
    setup: [
      "const handler = {",
      "  apply(callee, self, passed) {",
      "    return Reflect.apply(callee, self, passed);",
      "  },",
      "};",
    ],
    run: (callee, self, passed) => `new Proxy(${callee}, handler)(${list(passed)})`,
    self: "none",
    answer: "value",
  },
  {
    name: "promise-try",
    rows: ["Promise.try"],
    run: (callee, self, passed) => `Promise.try(${after(callee, passed)})`,
    self: "none",
    answer: "promise",
  },
  {
    name: "set-timeout",
    rows: ["setTimeout"],
    run: (callee, self, passed) => `setTimeout(${after(callee, ["0", ...passed])})`,
    self: "none",
    answer: "none",
    later: true,
  },
  {
    name: "set-interval",
    rows: ["setInterval"],
    run: (callee, self, passed) => `setInterval(${after(callee, ["1", ...passed])})`,
    finish: ["clearInterval(this);"],
    self: "none",
    answer: "none",
    later: true,
  },
  {
    name: "set-immediate",
    rows: ["setImmediate"],
    run: (callee, self, passed) => `setImmediate(${after(callee, passed)})`,
    self: "none",
    answer: "none",
    later: true,
  },
  {
    name: "process-next-tick",
    rows: ["process.nextTick"],
    run: (callee, self, passed) => `process.nextTick(${after(callee, passed)})`,
    self: "none",
    answer: "none",
    later: true,
  },
  {
    name: "queue-microtask",
    rows: ["queueMicrotask"],
    run: callee => `queueMicrotask(${callee})`,
    self: "none",
    answer: "none",
    later: true,
    most: 0,
  },
  {
    name: "emit-of-an-event-emitter",
    rows: ["node:events.EventEmitter.prototype.emit"],
    setup: events,
    before: callee => [`emitter.on("ready", ${callee});`],
    run: (callee, self, passed) => `emitter.emit(${after('"ready"', passed)})`,
    self: "emitter",
    answer: "none",
  },
  {
    name: "emit-for-a-listener-added-with-once",
    rows: ["node:events.EventEmitter.prototype.once"],
    setup: events,
    before: callee => [`emitter.once("ready", ${callee});`],
    run: (callee, self, passed) => `emitter.emit(${after('"ready"', passed)})`,
    self: "emitter",
    answer: "none",
  },
  {
    name: "emit-of-the-process",
    rows: ["%EventEmitter%.prototype.emit"],
    before: callee => [`process.on("ready", ${callee});`],
    run: (callee, self, passed) => `process.emit(${after('"ready"', passed)})`,
    self: "process",
    answer: "none",
  },
  {
    name: "run-of-an-async-local-storage",
    rows: ["node:async_hooks.AsyncLocalStorage.prototype.run"],
    setup: asyncHooks,
    run: (callee, self, passed) => `new AsyncLocalStorage().run(${after('"store"', [callee, ...passed])})`,
    self: "none",
    answer: "value",
  },
  {
    name: "exit-of-an-async-local-storage",
    rows: ["node:async_hooks.AsyncLocalStorage.prototype.exit"],
    setup: asyncHooks,
    run: (callee, self, passed) => `new AsyncLocalStorage().exit(${after(callee, passed)})`,
    self: "none",
    answer: "value",
  },
  {
    name: "a-function-bound-by-async-local-storage",
    rows: ["node:async_hooks.AsyncLocalStorage.bind"],
    setup: asyncHooks,
    run: (callee, self, passed) => `AsyncLocalStorage.bind(${callee})(${list(passed)})`,
    self: "none",
    answer: "value",
  },
  {
    name: "a-snapshot-of-async-local-storage",
    rows: ["node:async_hooks.AsyncLocalStorage.snapshot"],
    setup: asyncHooks,
    run: (callee, self, passed) => `AsyncLocalStorage.snapshot()(${after(callee, passed)})`,
    self: "none",
    answer: "value",
  },
  {
    name: "run-in-async-scope",
    rows: ["node:async_hooks.AsyncResource.prototype.runInAsyncScope"],
    setup: asyncHooks,
    run: (callee, self, passed) => `new AsyncResource("work").runInAsyncScope(${after(callee, [self, ...passed])})`,
    self: "passed",
    answer: "value",
  },
  {
    name: "a-function-bound-by-async-resource",
    rows: ["node:async_hooks.AsyncResource.bind"],
    setup: asyncHooks,
    run: (callee, self, passed) => `AsyncResource.bind(${callee})(${list(passed)})`,
    self: "none",
    answer: "value",
  },
];

const parameters = ordinals.join(", ");
const fiveKinds = ["1", "2.5", '"three"', "{ four: 4 }", '() => "five"'];
const usesOfFiveKinds = (names: readonly string[]) => [
  `console.log(typeof ${names[0]}, ${names[0]} + 1);`,
  `console.log(typeof ${names[1]}, ${names[1]} + 1);`,
  `console.log(typeof ${names[2]}, ${names[2]}.length);`,
  `console.log(typeof ${names[3]}, ${names[3]}.four);`,
  `console.log(typeof ${names[4]}, ${names[4]}());`,
];
const indent = (text: string[]) => text.map(line => `  ${line}`);

function program(
  forwarder: Forwarder,
  words: string,
  parts: {
    top?: string[];
    head?: string;
    body: string[];
    self?: string;
    passed: string[];
    afterwards?: string[];
    result?: (value: string) => string[];
    catches?: boolean;
  },
): Program {
  const runsLater = forwarder.later === true;
  const afterwards = parts.afterwards ?? [];
  const call = forwarder.run("target", parts.self ?? "undefined", parts.passed);
  const usesResult = parts.result !== undefined && forwarder.answer !== "none";
  const value = forwarder.answer === "promise" ? `await ${call}` : call;
  const statement = usesResult ? [`const result = ${value};`, ...parts.result!("result")] : [`${value};`];
  const guarded = parts.catches
    ? [
        "try {",
        ...indent(statement),
        "} catch (error) {",
        "  console.log(error instanceof RangeError, error.message);",
        "}",
      ]
    : statement;
  return {
    name: `${forwarder.name}-${words}`,
    rows: forwarder.rows,
    text: lines(
      forwarder.setup,
      parts.top,
      runsLater && afterwards.length > 0 && ["function afterwards() {", ...indent(afterwards), "}"],
      parts.head ?? `function target(${parameters}) {`,
      indent(parts.body),
      indent(forwarder.finish ?? []),
      runsLater && afterwards.length > 0 && "  afterwards();",
      "}",
      forwarder.before?.("target"),
      guarded,
      !runsLater && afterwards,
    ),
  };
}

function programsOf(forwarder: Forwarder): Program[] {
  const most = forwarder.most ?? 5;
  const programs: Program[] = [];
  if (most === 5) {
    programs.push(
      program(forwarder, "passes-five-arguments-of-five-kinds", {
        body: [...usesOfFiveKinds(ordinals), "console.log(arguments.length);"],
        passed: fiveKinds,
      }),
      program(forwarder, "passes-five-arguments-of-five-kinds-in-the-other-order", {
        body: [...usesOfFiveKinds([...ordinals].reverse()), "console.log(arguments.length);"],
        passed: [...fiveKinds].reverse(),
      }),
      program(forwarder, "passes-its-arguments-to-a-rest-parameter", {
        head: "function target(...rest) {",
        body: ["console.log(rest.length);", ...usesOfFiveKinds([0, 1, 2, 3, 4].map(index => `rest[${index}]`))],
        passed: fiveKinds,
      }),
      program(forwarder, "passes-two-arguments-to-a-callee-with-three-parameters", {
        head: 'function target(first, second, third, fourth = "default") {',
        body: [
          "console.log(first + 1, second.length);",
          "console.log(third === undefined, typeof third, fourth.length);",
          "console.log(arguments.length);",
        ],
        passed: ["1.5", '"two"'],
      }),
      program(forwarder, "passes-undefined-and-null", {
        body: [
          "console.log(first === undefined, typeof first);",
          "console.log(second === null, typeof second);",
          "console.log(third + 1, arguments.length);",
        ],
        passed: ["undefined", "null", "0.5"],
      }),
    );
    for (let index = 0; index < 5; index++) {
      programs.push(
        program(forwarder, `passes-a-fraction-as-the-${ordinals[index]}-argument`, {
          body: [`console.log(typeof ${ordinals[index]}, ${ordinals[index]} + 1);`],
          passed: [0, 1, 2, 3, 4].map(position => (position === index ? `${position}.5` : `${position}`)),
        }),
      );
    }
  }
  if (most >= 1) {
    programs.push(
      program(forwarder, "passes-an-object-that-the-callee-stores-into", {
        top: ["const box = { value: 1 };"],
        head: "function target(holder) {",
        body: ['holder.value = "text";'],
        passed: ["box"],
        afterwards: ["console.log(typeof box.value, box.value.length);"],
      }),
      program(forwarder, "passes-an-array-that-the-callee-pushes-into", {
        top: ["const numbers = [1, 2];"],
        head: "function target(holder) {",
        body: ['holder.push("three");'],
        passed: ["numbers"],
        afterwards: ["console.log(numbers.length, typeof numbers[2], numbers[2].length);"],
      }),
      program(forwarder, "passes-a-function-that-the-callee-calls", {
        top: ["function report(value) {", "  console.log(typeof value, value + 1);", "}"],
        head: "function target(callback) {",
        body: ["callback(1.5);"],
        passed: ["report"],
      }),
    );
  }
  programs.push(
    program(forwarder, "runs-a-callee-that-assigns-a-variable", {
      top: ["let state = 0;"],
      head: "function target() {",
      body: ['state = "changed";'],
      passed: [],
      afterwards: ["console.log(typeof state, state.length);"],
    }),
  );
  if (forwarder.self === "passed") {
    programs.push(
      program(forwarder, "passes-an-object-as-this", {
        head: "function target() {",
        body: ["console.log(typeof this, this.x + 1);"],
        self: "{ x: 1.5 }",
        passed: [],
      }),
      program(forwarder, "passes-a-string-as-this", {
        head: "function target() {",
        body: ["console.log(typeof this, this.length);"],
        self: '"text"',
        passed: [],
      }),
      program(forwarder, "passes-an-object-as-this-that-the-callee-stores-into", {
        top: ["const box = { value: 1 };"],
        head: "function target() {",
        body: ['this.value = "text";'],
        self: "box",
        passed: [],
        afterwards: ["console.log(typeof box.value, box.value.length);"],
      }),
    );
  } else if (forwarder.self === "none") {
    if (forwarder.finish === undefined) {
      programs.push(
        program(forwarder, "runs-a-callee-that-asks-what-this-is", {
          head: "function target() {",
          body: ["console.log(typeof this, this === undefined);"],
          passed: [],
        }),
      );
    }
  } else {
    programs.push(
      program(forwarder, "runs-the-listener-with-its-own-this", {
        head: "function target() {",
        body: [`console.log(typeof this, this === ${forwarder.self});`],
        passed: [],
      }),
    );
  }
  if (forwarder.answer !== "none") {
    programs.push(
      program(forwarder, "answers-the-object-that-the-callee-returns", {
        head: "function target() {",
        body: ["return { made: 1.5 };"],
        passed: [],
        result: value => [`console.log(typeof ${value}, ${value}.made + 1);`],
      }),
      program(forwarder, "answers-the-argument-that-the-callee-returns", {
        head: "function target(first, second) {",
        body: ["return second;"],
        passed: ["1", '"two"'],
        result: value => [`console.log(typeof ${value}, ${value}.length);`],
      }),
      program(forwarder, "lets-the-error-of-the-callee-through", {
        head: "function target() {",
        body: ['throw new RangeError("out of range");'],
        passed: [],
        catches: true,
      }),
    );
  }
  return programs;
}

interface Constructing {
  name: string;
  rows: string[];
  setup?: string[];
  run(callee: string, passed: string[]): string;
  newTarget?: string;
}

const constructing: Constructing[] = [
  {
    name: "reflect-construct",
    rows: ["Reflect.construct"],
    run: (callee, passed) => `Reflect.construct(${callee}, [${list(passed)}])`,
  },
  {
    name: "reflect-construct-with-an-array-like-object",
    rows: ["Reflect.construct"],
    run: (callee, passed) => `Reflect.construct(${callee}, ${arrayLike(passed)})`,
  },
  {
    name: "reflect-construct-with-a-subclass-as-new-target",
    rows: ["Reflect.construct"],
    setup: ["class Other extends Target {}"],
    run: (callee, passed) => `Reflect.construct(${callee}, [${list(passed)}], Other)`,
    newTarget: "Other",
  },
  {
    name: "new-of-a-bound-class",
    rows: ["Function.prototype.bind"],
    run: (callee, passed) => `new (${callee}.bind(${after("null", passed.slice(0, 2))}))(${list(passed.slice(2))})`,
  },
  {
    name: "new-of-a-proxy-without-traps",
    rows: ["Proxy"],
    run: (callee, passed) => `new (new Proxy(${callee}, {}))(${list(passed)})`,
    newTarget: "proxy",
  },
  {
    name: "new-of-a-proxy-whose-construct-trap-uses-reflect-construct",
    rows: ["Proxy", "Reflect.construct"],
    setup: [
      "const handler = {",
      "  construct(callee, passed) {",
      "    return Reflect.construct(callee, passed);",
      "  },",
      "};",
    ],
    run: (callee, passed) => `new (new Proxy(${callee}, handler))(${list(passed)})`,
  },
];

function constructingProgramsOf(forwarder: Constructing): Program[] {
  const make = (
    words: string,
    classBody: string[],
    passed: string[],
    afterwards: string[],
    top: string[] = [],
  ): Program => ({
    name: `${forwarder.name}-${words}`,
    rows: forwarder.rows,
    text: lines(
      top,
      "class Target {",
      indent(classBody),
      "}",
      forwarder.setup,
      `const made = ${forwarder.run("Target", passed)};`,
      afterwards,
    ),
  });
  const programs = [
    make(
      "passes-five-arguments-of-five-kinds",
      [
        `constructor(${parameters}) {`,
        ...indent([...usesOfFiveKinds(ordinals), "console.log(arguments.length);"]),
        "}",
      ],
      fiveKinds,
      ["console.log(made instanceof Target);"],
    ),
    make(
      "makes-an-object-with-the-fields-that-the-constructor-stores",
      [`constructor(${parameters}) {`, ...indent(ordinals.map(name => `this.${name} = ${name};`)), "}"],
      fiveKinds,
      [...usesOfFiveKinds(ordinals.map(name => `made.${name}`)), "console.log(Object.keys(made).join());"],
    ),
    make(
      "makes-an-object-whose-method-runs",
      ["constructor(size) {", "  this.size = size;", "}", "double() {", "  return this.size * 2;", "}"],
      ["1.5"],
      ["console.log(made.double());"],
    ),
    make(
      "passes-an-object-that-the-constructor-stores-into",
      ["constructor(holder) {", '  holder.value = "text";', "}"],
      ["box"],
      ["console.log(typeof box.value, box.value.length);"],
      ["const box = { value: 1 };"],
    ),
  ];
  if (forwarder.newTarget !== "proxy") {
    programs.push(
      make(
        "runs-a-constructor-that-asks-for-new-target",
        ["constructor() {", "  this.isTarget = new.target === Target;", "  this.name = new.target.name;", "}"],
        [],
        ["console.log(made.isTarget, made.name, Object.getPrototypeOf(made) === Target.prototype);"],
      ),
    );
  }
  for (let index = 0; index < 5; index++) {
    programs.push(
      make(
        `passes-a-fraction-as-the-${ordinals[index]}-argument`,
        [`constructor(${parameters}) {`, `  console.log(typeof ${ordinals[index]}, ${ordinals[index]} + 1);`, "}"],
        [0, 1, 2, 3, 4].map(position => (position === index ? `${position}.5` : `${position}`)),
        [],
      ),
    );
  }
  return programs;
}

const throughForwarders: [string, string[], string[]][] = [
  [
    "math-max-called-by-call",
    ["Function.prototype.call", "Math.max"],
    ["const most = Math.max.call(null, 1, 2.5, 2);", "console.log(typeof most, most + 1);"],
  ],
  [
    "math-max-called-by-apply",
    ["Function.prototype.apply", "Math.max"],
    ["const most = Math.max.apply(null, [1, 2.5, 2]);", "console.log(typeof most, most + 1);"],
  ],
  [
    "math-max-called-by-reflect-apply",
    ["Reflect.apply", "Math.max"],
    ["const most = Reflect.apply(Math.max, null, [1, 2.5, 2]);", "console.log(typeof most, most + 1);"],
  ],
  [
    "array-push-called-by-call-stores-a-string-among-numbers",
    ["Function.prototype.call", "Array.prototype.push"],
    [
      "const numbers = [1, 2];",
      'Array.prototype.push.call(numbers, "three");',
      "console.log(numbers.length, typeof numbers[2], numbers[2].length);",
    ],
  ],
  [
    "array-push-called-by-apply-stores-strings-among-numbers",
    ["Function.prototype.apply", "Array.prototype.push"],
    [
      "const numbers = [1, 2];",
      'Array.prototype.push.apply(numbers, ["three", "four"]);',
      "console.log(numbers.length, typeof numbers[3], numbers[3].length);",
    ],
  ],
  [
    "array-push-called-by-reflect-apply-stores-a-string-among-numbers",
    ["Reflect.apply", "Array.prototype.push"],
    [
      "const numbers = [1, 2];",
      'Reflect.apply(Array.prototype.push, numbers, ["three"]);',
      "console.log(numbers.length, typeof numbers[2], numbers[2].length);",
    ],
  ],
  [
    "array-push-bound-to-a-list-stores-a-string-among-numbers",
    ["Function.prototype.bind", "Array.prototype.push"],
    [
      "const numbers = [1, 2];",
      "const add = numbers.push.bind(numbers);",
      'add("three");',
      "console.log(numbers.length, typeof numbers[2], numbers[2].length);",
    ],
  ],
  [
    "array-slice-called-by-call-copies-an-arguments-object",
    ["Function.prototype.call", "Array.prototype.slice"],
    [
      "function collect() {",
      "  return Array.prototype.slice.call(arguments, 1);",
      "}",
      'const rest = collect(1, 2.5, "three");',
      "console.log(rest.length, rest[0] + 1, rest[1].length);",
    ],
  ],
  [
    "array-concat-called-by-apply-joins-lists",
    ["Function.prototype.apply", "Array.prototype.concat"],
    [
      'const flat = Array.prototype.concat.apply([], [[1.5], ["two"]]);',
      "console.log(flat.length, flat[0] + 1, flat[1].length);",
    ],
  ],
  [
    "array-map-called-by-call-over-a-string",
    ["Function.prototype.call", "Array.prototype.map"],
    [
      'const codes = Array.prototype.map.call("ab", letter => letter.charCodeAt(0));',
      "console.log(codes.length, codes[0] + 1, codes[1] + 1);",
    ],
  ],
  [
    "array-for-each-called-by-call-over-an-array-like-object",
    ["Function.prototype.call", "Array.prototype.forEach"],
    [
      'Array.prototype.forEach.call({ length: 2, 0: 1.5, 1: "two" }, (value, index) => {',
      "  console.log(index, typeof value, value);",
      "});",
    ],
  ],
  [
    "has-own-property-called-by-call",
    ["Function.prototype.call", "Object.prototype.hasOwnProperty"],
    [
      "const record = { present: 1 };",
      'console.log(Object.prototype.hasOwnProperty.call(record, "present"), Object.prototype.hasOwnProperty.call(record, "absent"));',
    ],
  ],
  [
    "object-to-string-called-by-call",
    ["Function.prototype.call", "Object.prototype.toString"],
    [
      "console.log(Object.prototype.toString.call([]), Object.prototype.toString.call(null), Object.prototype.toString.call(1.5));",
    ],
  ],
  [
    "string-from-char-code-called-by-apply",
    ["Function.prototype.apply", "String.fromCharCode"],
    ["const text = String.fromCharCode.apply(null, [104, 105]);", "console.log(typeof text, text.length, text);"],
  ],
  [
    "object-assign-called-by-apply-stores-a-string-over-a-number",
    ["Function.prototype.apply", "Object.assign"],
    [
      "const box = { value: 1 };",
      'Object.assign.apply(null, [box, { value: "text" }]);',
      "console.log(typeof box.value, box.value.length);",
    ],
  ],
  [
    "map-set-called-by-call-stores-a-string-among-numbers",
    ["Function.prototype.call", "Map.prototype.set"],
    [
      'const sizes = new Map([["small", 1]]);',
      'Map.prototype.set.call(sizes, "large", "huge");',
      'console.log(sizes.size, typeof sizes.get("large"), sizes.get("large").length);',
    ],
  ],
  [
    "a-callback-reaches-array-map-through-call",
    ["Function.prototype.call", "Array.prototype.map"],
    [
      "function double(value) {",
      "  return value * 2;",
      "}",
      "const doubled = Array.prototype.map.call([1.5, 2], double);",
      "console.log(doubled[0] + 1, doubled[1] + 1);",
    ],
  ],
  [
    "a-callback-reaches-set-timeout-through-apply",
    ["Function.prototype.apply", "setTimeout"],
    [
      "function report(value) {",
      "  console.log(typeof value, value + 1);",
      "}",
      "setTimeout.apply(null, [report, 0, 1.5]);",
    ],
  ],
  [
    "a-callback-reaches-promise-then-through-call",
    ["Function.prototype.call", "Promise.prototype.then"],
    [
      "function report(value) {",
      "  console.log(typeof value, value + 1);",
      "}",
      "await Promise.prototype.then.call(Promise.resolve(1.5), report);",
    ],
  ],
];

const callees: [string, string[], (call: (callee: string, self: string, passed: string[]) => string) => string[]][] = [
  [
    "an-arrow-function",
    [],
    call => [
      "const target = (first, second) => {",
      "  console.log(typeof second, second + 1);",
      "};",
      `${call("target", "null", ["1", "2.5"])};`,
    ],
  ],
  [
    "a-method-of-a-class",
    [],
    call => [
      "class Counter {",
      "  count = 1.5;",
      "  add(first, second) {",
      "    return this.count + second;",
      "  }",
      "}",
      `console.log(${call("Counter.prototype.add", "new Counter()", ["1", "2.5"])});`,
    ],
  ],
  [
    "an-async-function",
    [],
    call => [
      "async function target(first, second) {",
      "  await null;",
      "  return second + 1;",
      "}",
      `console.log(await ${call("target", "null", ["1", "2.5"])});`,
    ],
  ],
  [
    "a-generator-function",
    [],
    call => [
      "function* target(first, second) {",
      "  yield first + 1;",
      "  yield second.length;",
      "}",
      `console.log([...${call("target", "null", ["1.5", '"two"'])}].join());`,
    ],
  ],
  [
    "a-closure",
    [],
    call => [
      "function adder(base) {",
      "  return function (first, second) {",
      "    return base + second;",
      "  };",
      "}",
      `console.log(${call("adder(0.5)", "null", ["1", "2"])});`,
    ],
  ],
  [
    "a-function-read-from-a-field",
    [],
    call => [
      "const holder = {",
      "  work(first, second) {",
      "    return second.length;",
      "  },",
      "};",
      `console.log(${call("holder.work", "holder", ["1", '"two"'])});`,
    ],
  ],
];

const sloppyReceivers: [string, string, string[]][] = [
  ["a-string", '"text"', ['console.log(typeof this, this instanceof String, this.length, this.valueOf() === "text");']],
  ["a-number", "1.5", ["console.log(typeof this, this instanceof Number, this + 1);"]],
  ["undefined", "undefined", ["console.log(typeof this, this === globalThis);"]],
  ["null", "null", ["console.log(typeof this, this === globalThis);"]],
];
const showsTheMode = ["console.log(", "  (function () {", "    return this === undefined;", "  })(),", ");"];

function sloppyPrograms(): Program[] {
  const programs: Program[] = [];
  for (const forwarder of forwarders) {
    if (forwarder.self !== "passed" || forwarder.setup?.some(line => line.startsWith("import "))) continue;
    for (const [words, self, body] of sloppyReceivers) {
      programs.push({
        name: `${forwarder.name}-passes-${words}-as-this-to-sloppy-code`,
        rows: forwarder.rows,
        extension: "cjs",
        text: lines(
          showsTheMode,
          forwarder.setup,
          "function target() {",
          indent(body),
          "}",
          forwarder.before?.("target"),
          `${forwarder.run("target", self, [])};`,
        ),
      });
    }
  }
  const callbacks: [string, string[], string][] = [
    ["array-for-each", ["Array.prototype.forEach"], "[1].forEach(target)"],
    ["array-for-each-with-a-string-as-this", ["Array.prototype.forEach"], '[1].forEach(target, "text")'],
    ["array-map", ["Array.prototype.map"], "[1].map(target)"],
    ["array-sort", ["Array.prototype.sort"], "[1, 2].sort(target)"],
    ["array-from", ["Array.from"], "Array.from([1], target)"],
    ["string-replace", ["String.prototype.replace"], '"a".replace("a", target)'],
    ["map-for-each", ["Map.prototype.forEach"], "new Map([[1, 2]]).forEach(target)"],
    ["set-for-each", ["Set.prototype.forEach"], "new Set([1]).forEach(target)"],
    ["json-parse", ["JSON.parse"], 'JSON.parse("1", target)'],
    ["promise-then", ["Promise.prototype.then"], "Promise.resolve(1).then(target)"],
    ["the-promise-constructor", ["Promise"], "new Promise(target)"],
    ["set-timeout", ["setTimeout"], "setTimeout(target, 0)"],
    ["queue-microtask", ["queueMicrotask"], "queueMicrotask(target)"],
    ["process-next-tick", ["process.nextTick"], "process.nextTick(target)"],
  ];
  for (const [words, rows, call] of callbacks) {
    programs.push({
      name: `${words}-runs-a-sloppy-callback-that-asks-what-this-is`,
      rows,
      extension: "cjs",
      text: lines(
        showsTheMode,
        "function target() {",
        "  console.log(typeof this, this === globalThis, this === undefined, this instanceof String);",
        "}",
        `${call};`,
      ),
    });
  }
  return programs;
}

export function forwardingPrograms(): Program[] {
  const programs = [
    ...forwarders.flatMap(programsOf),
    ...constructing.flatMap(constructingProgramsOf),
    ...sloppyPrograms(),
  ];
  for (const [name, rows, text] of throughForwarders) programs.push({ name, rows, text: lines(text) });
  for (const forwarder of forwarders.filter(each =>
    ["function-call", "function-apply", "function-bind-with-every-argument", "reflect-apply"].includes(each.name),
  )) {
    for (const [words, , text] of callees) {
      programs.push({
        name: `${forwarder.name}-runs-${words}`,
        rows: forwarder.rows,
        text: lines(text(forwarder.run)),
      });
    }
  }
  programs.push({
    name: "a-plain-call-passes-five-arguments-of-five-kinds-honest",
    rows: [],
    text: lines(
      `function target(${parameters}) {`,
      indent([...usesOfFiveKinds(ordinals), "console.log(arguments.length);"]),
      "}",
      `target(${list(fiveKinds)});`,
    ),
  });
  programs.push({
    name: "new-passes-five-arguments-of-five-kinds-honest",
    rows: [],
    text: lines(
      "class Target {",
      indent([
        `constructor(${parameters}) {`,
        ...indent([...usesOfFiveKinds(ordinals), "console.log(arguments.length);"]),
        "}",
      ]),
      "}",
      `console.log(new Target(${list(fiveKinds)}) instanceof Target);`,
    ),
  });
  return programs;
}
