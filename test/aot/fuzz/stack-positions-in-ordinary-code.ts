// Writes a program of ordinary code, laid out over several lines the way a formatter does it: classes, callbacks of built-ins, async functions,
// generators, patterns, optional chains, templates, handlers that throw again. Every value passes through `step()`, which throws at the call whose
// number the program asks for. The program runs each of its scenarios once per call and prints the function, line and column of every frame.
import type { Random } from "./random";

type Doc =
  | string
  | Doc[]
  | { kind: "group"; body: Doc }
  | { kind: "indent"; body: Doc }
  | { kind: "line"; flat: string | null }
  | { kind: "broken"; text: string };

const group = (...body: Doc[]): Doc => ({ kind: "group", body });
const indent = (...body: Doc[]): Doc => ({ kind: "indent", body });
const line: Doc = { kind: "line", flat: " " };
const softline: Doc = { kind: "line", flat: "" };
const hardline: Doc = { kind: "line", flat: null };
const whenBroken = (text: string): Doc => ({ kind: "broken", text });

function flatWidth(doc: Doc): number {
  if (typeof doc === "string") return doc.length;
  if (Array.isArray(doc)) return doc.reduce((sum: number, part) => sum + flatWidth(part), 0);
  if (doc.kind === "line") return doc.flat === null ? Infinity : doc.flat.length;
  return doc.kind === "broken" ? 0 : flatWidth(doc.body);
}

function print(doc: Doc, width: number): string {
  let text = "";
  let column = 0;
  const visit = (doc: Doc, level: number, isFlat: boolean) => {
    if (typeof doc === "string") {
      text += doc;
      column += doc.length;
    } else if (Array.isArray(doc)) {
      for (const part of doc) visit(part, level, isFlat);
    } else if (doc.kind === "group") {
      visit(doc.body, level, isFlat || column + flatWidth(doc.body) <= width);
    } else if (doc.kind === "indent") {
      visit(doc.body, level + 1, isFlat);
    } else if (doc.kind === "broken") {
      if (!isFlat) visit(doc.text, level, isFlat);
    } else if (isFlat && doc.flat !== null) {
      visit(doc.flat, level, isFlat);
    } else {
      text += "\n" + "  ".repeat(level);
      column = 2 * level;
    }
  };
  visit(doc, 0, false);
  return text;
}

const join = (parts: Doc[], separator: Doc): Doc[] =>
  parts.flatMap((part, index) => (index ? [separator, part] : [part]));
const list = (open: string, parts: Doc[], close: string, pad: Doc = softline, endsInRest = false): Doc =>
  parts.length
    ? group(open, indent(pad, join(parts, [",", line]), endsInRest ? "" : whenBroken(",")), pad, close)
    : open + close;
const block = (statements: Doc[]): Doc =>
  statements.length ? ["{", indent(statements.map(statement => [hardline, statement])), hardline, "}"] : "{}";

export interface Callable {
  // How the file that calls it writes it: a name, or an expression such as `library.work1`.
  name: string;
  arity: number;
  // The name that the last parameter, a pattern, takes out of an object.
  recordKey: string | null;
  isAsync: boolean;
  yields: boolean;
  // Its name holds an `await`.
  isAwaited?: boolean;
}

export interface Member extends Callable {
  kind: "method" | "getter" | "setter";
  isStatic: boolean;
  // `name = (given) => ..` in a class, `name: (given) => ..` in an object literal.
  isArrow: boolean;
}

export interface Shape {
  name: string;
  // How a typed file writes the type of its instances, where that is not its name. Nothing: it writes no type.
  typeName?: string | null;
  arity: number;
  members: Member[];
  base: Shape | null;
  // To TypeScript the class is `any`, and an heir of it that writes no constructor takes no arguments.
  isAny?: boolean;
}

interface Scope {
  numbers: string[];
  lists: string[];
  objects: { name: string; shape: Shape }[];
  self: Shape | null;
  isStaticSelf: boolean;
  isStaticBlock: boolean;
  isAsync: boolean;
  yields: boolean;
  depth: number;
}

// In a program of several files it is a file of its own, which only untyped files use.
export const constructorFunction = `function Legacy(value) {
  this.value = step(value);
}
Legacy.prototype.read = function () {
  return step(this.value);
};
Legacy.prototype.chainTo = function (value) {
  this.value += step(value);
  return this;
};
Object.defineProperty(Legacy.prototype, "half", {
  get: function () {
    return step(this.value) / 2;
  },
});
Legacy.of = function (value) {
  return new Legacy(step(value));
};
`;

// One file of a program of several files (stack-positions-across-files.ts).
export interface Part {
  // `helpers` holds `step()` and what every file uses. `loaded` runs its calls while it is loaded, outside any handler.
  role: "helpers" | "library" | "loaded" | "main";
  // No two files of a program declare the same name.
  counters: { names: number; literals: number };
  // The lines that bring in what it uses of other files.
  heading: string;
  functions: Callable[];
  shapes: Shape[];
  // It may wait at its top level.
  mayAwait: boolean;
  // In `main`: statements that load the files which throw while they are loaded.
  loads: string;
  // A class or a function that is the default export may have no name. The file itself cannot reach it then.
  mayOmitNames: boolean;
}

// What the file `helpers` declares for a file that is typed or not.
export const helperNames = (isTyped: boolean, isBroad: boolean) => [
  ..."state step Chain emitted framesOf caught seen sum pick tag maybe later counter holder stream total".split(" "),
  ...(isTyped ? ["same", "Level", "Units"] : []),
  ...(isBroad ? "guarded wrapped Built gauge Texts texts range both Bag visited".split(" ") : []),
];

export interface Exported {
  // `default`, or the name that another file asks for.
  exportedAs: string;
  callable?: Callable;
  shape?: Shape;
}

export interface Options {
  isTyped?: boolean;
  isWide?: boolean;
  isCommonJs?: boolean;
  isBroad?: boolean;
  part?: Part;
}

export function generate(random: Random, isTyped = false, isWide = false, isCommonJs = false, isBroad = false): string {
  return write(random, { isTyped, isWide, isCommonJs, isBroad }).text;
}

// `isWide` adds what an executable shows otherwise than `bun run` today: members of enums that call, parameters of async functions that call, and async
// generators that another async function steps.
// `isCommonJs` writes a CommonJS file of sloppy code.
// `isBroad` adds proxies, accessors on prototypes, constructor functions, tagged templates of classes, generators that are spread, and callbacks of more built-ins.
export function write(
  random: Random,
  { isTyped = false, isWide = false, isCommonJs = false, isBroad = false, part }: Options,
): { text: string; exports: Exported[] } {
  const width = random.pick([60, 80, 80, 100, 120]);
  const typed = (text: string) => (isTyped ? text : "");
  const semi = random.chance(0.8) ? ";" : "";
  const hasComments = random.chance(0.5);
  const hasOtherAlphabets = random.chance(0.4);
  const texts = hasOtherAlphabets
    ? ['"żółć"', '"日本語"', '"🙂🙂"', '"(a"', '"}"']
    : ['"text"', '"(a"', '"}"', '"it\'s"'];
  const notes = hasOtherAlphabets
    ? ["naïve → first", "ключ (1)", "🙂 }", "日本語"]
    : ["the first one", "doesn't retry (yet)", 'see "notes" }', "TODO: a) b)"];
  const inlineNote = (): Doc => (hasComments && random.chance(0.08) ? `/* ${random.pick(notes)} */ ` : "");
  const trailingNote = (): Doc => (hasComments && random.chance(0.1) ? ` // ${random.pick(notes)}` : "");
  const functions: Callable[] = [...(part?.functions ?? [])];
  const shapes: Shape[] = [...(part?.shapes ?? [])];
  const counters = part?.counters ?? { names: 0, literals: 0 };
  const fresh = (stem: string) => `${stem}${++counters.names}`;
  const literal = () => String(++counters.literals);
  const inner = (scope: Scope, changes: Partial<Scope> = {}): Scope => ({
    ...scope,
    numbers: [...scope.numbers],
    lists: [...scope.lists],
    objects: [...scope.objects],
    depth: scope.depth + 1,
    ...changes,
  });
  const inFunction = (scope: Scope, changes: Partial<Scope> = {}) =>
    inner(scope, { isAsync: false, yields: false, isStaticBlock: false, ...changes });
  const isDeep = (scope: Scope) => scope.depth > 4;

  const step = (value: Doc): Doc => ["step", list("(", [value], ")")];
  const leaf = (scope: Scope): Doc =>
    random.chance(0.4) && scope.numbers.length
      ? random.pick(scope.numbers)
      : random.chance(0.1)
        ? [step(random.pick(texts)), ".length"]
        : random.chance(0.7)
          ? step(literal())
          : literal();
  const args = (scope: Scope, count: number, recordKey: string | null = null): Doc =>
    list(
      "(",
      Array.from({ length: count }, (_, index) =>
        recordKey === null || index < count - 1
          ? [inlineNote(), number(inner(scope))]
          : random.chance(0.5)
            ? "{}"
            : list("{", [[recordKey, ": ", number(inner(scope))]], "}", line),
      ),
      ")",
    );
  const parenthesized = (doc: Doc): Doc => ["(", doc, ")"];

  function arrow(scope: Scope, parameters: string[], annotations: string[], changes: Partial<Scope> = {}): Doc {
    const body = inFunction(scope, changes);
    body.numbers.push(...parameters.filter(name => /^[a-z]\w*$/.test(name)));
    const head =
      parameters.length === 1 && !isTyped && /^\w+$/.test(parameters[0]) && random.chance(0.5)
        ? parameters[0]
        : `(${parameters.map((name, index) => name + typed(annotations[index] ?? "")).join(", ")})`;
    const prefix = changes.isAsync ? "async " : "";
    if (random.chance(0.6)) return [prefix, head, " => ", number(body)];
    return [prefix, head, " => ", block(statements(body, random.between(0, 2), true))];
  }

  function callOf(scope: Scope, callee: Doc, target: Callable): Doc {
    const call: Doc = [callee, args(scope, target.arity, target.recordKey)];
    if (target.yields) {
      if (target.isAsync) return ["(await total", list("(", [call], ")"), ")"];
      return random.chance(0.5) ? ["sum", list("(", [["[...", call, "]"]], ")")] : [call, ".next().value", typed("!")];
    }
    return target.isAsync ? parenthesized(["await ", call]) : call;
  }

  const canCall = (scope: Scope, target: Callable) => (!target.isAsync && !target.isAwaited) || scope.isAsync;

  function memberUse(scope: Scope, receiver: Doc, member: Member, isOptional: boolean): Doc {
    const dot = isOptional ? "?." : ".";
    if (member.kind === "getter") return [receiver, dot, member.name];
    if (member.kind === "setter") return parenthesized([receiver, ".", member.name, " = ", number(inner(scope))]);
    return callOf(scope, [receiver, dot, member.name], member);
  }

  function construct(scope: Scope, shape: Shape): Doc {
    return ["new ", shape.name, args(scope, shape.arity)];
  }

  function listOf(scope: Scope): Doc {
    const next = inner(scope);
    const kinds: (() => Doc)[] = [
      () =>
        list(
          "[",
          Array.from({ length: random.between(1, 3) }, () => number(next)),
          "]",
        ),
      () => list("[", [number(next), ["...", listOf(next)]], "]"),
      () => ["Array.from", list("(", ["{ length: 2 }", arrow(next, ["_", "index"], [": unknown", ": number"])], ")")],
      () => chain(next, true),
      () => ["Object.values", list("(", [record(next)], ")")],
    ];
    if (scope.lists.length)
      kinds.push(
        () => random.pick(scope.lists),
        () => random.pick(scope.lists),
      );
    return isDeep(scope) ? kinds[0]() : random.pick(kinds)();
  }

  function record(scope: Scope): Doc {
    const next = inner(scope);
    const parts: Doc[] = [];
    for (let index = random.between(1, 3); index > 0; index--) {
      const key = fresh("key");
      parts.push(
        random.weighted<() => Doc>([
          [5, () => [key, ": ", number(next)]],
          [hasOtherAlphabets ? 2 : 0, () => [`"${key}é🙂"`, ": ", number(next)]],
          [1, () => ["[", "`" + key + "${", number(inner(next, { isAsync: false })), "}`", "]: ", number(next)]],
          [1, () => ["...", list("{", [[fresh("key"), ": ", number(next)]], "}", line)]],
        ])(),
      );
    }
    return list("{", parts, "}", line);
  }

  // `list.map(..).filter(..)`, which ends in a list or in a number.
  function chain(scope: Scope, endsInList: boolean): Doc {
    const next = inner(scope);
    const links: Doc[] = [];
    let takesList = false;
    for (let index = random.between(endsInList ? 1 : 0, 2); index > 0; index--) {
      links.push(
        random.pick<() => Doc>([
          () => [".map", list("(", [arrow(next, [fresh("item")], [": number"])], ")")],
          () => [".map", list("(", [arrow(next, [fresh("item"), fresh("index")], [": number", ": number"])], ")")],
          () => [".filter", list("(", [arrow(next, [fresh("item")], [": number"])], ")")],
          () => [".flatMap", list("(", [arrowToList(next)], ")")],
          () => [".sort", list("(", [arrow(next, [fresh("left"), fresh("right")], [": number", ": number"])], ")")],
          () => ".slice(0, 2)",
          () => ((takesList = true), [".concat", list("(", [listOf(next)], ")")]),
        ])(),
      );
    }
    let isLoose = false;
    if (!endsInList) {
      links.push(
        random.pick<() => Doc>([
          () => [
            ".reduce",
            list("(", [arrow(next, [fresh("sum"), fresh("item")], [": number", ": number"]), number(next)], ")"),
          ],
          () => [".findIndex", list("(", [arrow(next, [fresh("item")], [": number"])], ")")],
          () => [".indexOf", list("(", [number(next)], ")")],
          () => ".length",
          () => ((isLoose = true), [".at", list("(", [number(next)], ")"), " ?? ", number(next)]),
        ])(),
      );
    }
    // A list of nothing but members of an enum takes no other number.
    const head = takesList ? parenthesized([listOf(next), typed(" as number[]")]) : listOf(next);
    const whole = group(head, links.length > 1 ? indent(links.map(link => [softline, link])) : links);
    return isLoose ? parenthesized(whole) : whole;
  }

  function arrowToList(scope: Scope): Doc {
    const name = fresh("item");
    const body = inFunction(scope);
    body.numbers.push(name);
    return [`(${name}${typed(": number")}) => `, list("[", [name, number(body)], "]")];
  }

  function number(scope: Scope): Doc {
    if (isDeep(scope)) return leaf(scope);
    const next = inner(scope);
    const choices: [number, () => Doc][] = [
      [8, () => leaf(scope)],
      [3, () => step(number(next))],
      [2, () => group(number(next), " ", random.pick(["+", "-", "*", "|"]), indent(line, number(next)))],
      [1, () => parenthesized(group(number(next), " ", random.pick(["&&", "||", "??"]), indent(line, number(next))))],
      [1, () => parenthesized(group(number(next), indent(line, "? ", number(next), line, ": ", number(next))))],
      [2, () => chain(next, false)],
      [
        1,
        () => [
          "Number",
          list("(", [["`", "${", number(next), "}", random.chance(0.5) ? ["${", number(next), "}"] : "", "`"]], ")"),
        ],
      ],
      [1, () => ["tag`a${", number(next), "}b${", number(next), "}`"]],
      [
        1,
        () => [
          "sum",
          list(
            "(",
            [["Object.values", list("(", [[record(next), typed(" satisfies Record<string, number>")]], ")")]],
            ")",
          ),
        ],
      ],
      [1, () => [parenthesized(arrow(next, [], [])), "()"]],
      [
        1,
        () => [
          "(function ",
          typed("(): number ") || "() ",
          block(statements(inFunction(next, { self: null }), random.between(0, 2), true)),
          ")()",
        ],
      ],
      [1, () => [random.pick(["-", "+", "~"]), step(number(next))]],
      [1, () => ["Math.max", list("(", [number(next), number(next)], ")")]],
      [1, () => ["Math.max", list("(", [["...", listOf(next)]], ")")]],
      [
        1,
        () => [
          "Number",
          list(
            "(",
            [
              [
                "JSON.stringify",
                list("(", [number(next), arrow(next, ["_key", fresh("value")], [": string", ": number"])], ")"),
              ],
            ],
            ")",
          ),
        ],
      ],
      [1, () => ['"aa".replace', list("(", ["/a/g", textArrow(next)], ")"), ".length"]],
      [1, () => ["pick", list("(", [record(next)], ")")]],
      [
        2,
        () =>
          group(
            "new Chain()",
            indent(
              Array.from({ length: random.between(1, 3) }, () => [softline, ".add", list("(", [number(next)], ")")]),
              softline,
              random.pick([".done", ".total", ".end()"]),
            ),
          ),
      ],
      [1, () => ["`${", list("{", [["toString: ", textArrow(next)]], "}", line), "}`.length"]],
      [
        1,
        () => [
          "Number",
          list(
            "(",
            [
              [
                "{",
                indent(line, "valueOf() ", block([["return ", number(inFunction(next, { self: null })), semi]]), ","),
                line,
                "}",
              ],
            ],
            ")",
          ),
        ],
      ],
      [
        1,
        () => [
          "JSON.stringify",
          list(
            "(",
            [
              [
                "{",
                indent(line, "toJSON() ", block([["return ", number(inFunction(next, { self: null })), semi]]), ","),
                line,
                "}",
              ],
            ],
            ")",
          ),
          ".length",
        ],
      ],
      [
        1,
        () => [
          "JSON.parse",
          list(
            "(",
            [
              '"[1, 2]"',
              [
                "(_key",
                typed(": string"),
                ", value",
                typed(": unknown"),
                ') => (typeof value === "number" ? ',
                number(inFunction(next)),
                " : value)",
              ],
            ],
            ")",
          ),
          ".length",
        ],
      ],
      [
        1,
        () =>
          parenthesized([
            "new Map",
            list("(", [list("[", [list("[", ["1", number(next)], "]")], "]")], ")"),
            ".get(1) ?? ",
            number(next),
          ]),
      ],
      [1, () => ["[...new Set", list("(", [listOf(next)], ")"), "].length"]],
      [1, () => ["emitted", list("(", [number(next), arrow(next, [fresh("value")], [": number"])], ")")]],
      [
        1,
        () =>
          parenthesized([
            "/[)}]/.test",
            list("(", [["String", list("(", [number(next)], ")")]], ")"),
            " ? ",
            number(next),
            " : ",
            number(next),
          ]),
      ],
      [
        1,
        () =>
          isTyped
            ? parenthesized(["maybe?.", list("(", [number(next)], ")"), " ?? ", number(next)])
            : ["maybe", random.chance(0.5) ? "?." : "", list("(", [number(next)], ")")],
      ],
      [1, () => ["holder.inner?.deep.read", list("(", [number(next)], ")")]],
      [1, () => parenthesized(["holder.missing?.deep.read", list("(", [number(next)], ")"), " ?? ", number(next)])],
      [1, () => ["holder[", step('"inner"'), typed(' as "inner"'), "].deep.read", list("(", [number(next)], ")")]],
    ];
    const callable = functions.filter(target => canCall(scope, target));
    if (callable.length) {
      choices.push([
        5,
        () => {
          const target = random.pick(callable);
          if (!target.isAsync && !target.yields && target.recordKey === null && random.chance(0.15)) {
            const given = Array.from({ length: target.arity }, () => number(next));
            return random.pick<() => Doc>([
              () => [target.name, ".call", list("(", ["null", ...given], ")")],
              () => [target.name, ".apply", list("(", ["null", list("[", given, "]")], ")")],
              () => [
                target.name,
                ".bind",
                list("(", ["null", ...given.slice(0, 1)], ")"),
                list("(", given.slice(1), ")"),
              ],
            ])();
          }
          return callOf(next, target.name, target);
        },
      ]);
    }
    if (shapes.length) {
      choices.push([
        3,
        () => {
          const shape = random.pick(shapes);
          const usable = shape.members.filter(member => canCall(scope, member));
          if (!usable.length) return [construct(next, shape), ".size"];
          const member = random.pick(usable);
          if (member.isStatic) return memberUse(next, shape.name, member, false);
          return memberUse(
            next,
            member.kind === "setter" ? parenthesized(construct(next, shape)) : construct(next, shape),
            member,
            false,
          );
        },
      ]);
    }
    if (scope.objects.length) {
      choices.push([
        4,
        () => {
          const object = random.pick(scope.objects);
          const usable = object.shape.members.filter(member => !member.isStatic && canCall(scope, member));
          return usable.length
            ? memberUse(next, object.name, random.pick(usable), random.chance(0.15))
            : [object.name, ".size"];
        },
      ]);
    }
    if (scope.self) {
      const self = scope.self;
      const usable = self.members.filter(member => member.isStatic === scope.isStaticSelf && canCall(scope, member));
      if (usable.length) choices.push([3, () => memberUse(next, "this", random.pick(usable), false)]);
      const inherited = (self.base?.members ?? []).filter(
        member => !member.isStatic && !member.isArrow && member.kind !== "setter" && canCall(scope, member),
      );
      if (inherited.length && !scope.isStaticSelf)
        choices.push([3, () => memberUse(next, "super", random.pick(inherited), false)]);
    }
    if (scope.isAsync) {
      choices.push(
        [2, () => parenthesized(["await ", number(next)])],
        [1, () => parenthesized(["await later", list("(", [number(next)], ")")])],
        [
          1,
          () =>
            parenthesized([
              "await Promise.resolve",
              list("(", [number(next)], ")"),
              ".then",
              typed("<number>"),
              list("(", [arrow(next, [fresh("value")], [": number"])], ")"),
            ]),
        ],
        [
          1,
          () => [
            "sum",
            list(
              "(",
              [
                [
                  "await Promise.all",
                  list("(", [list("[", [["later", list("(", [number(next)], ")")], number(next)], "]")], ")"),
                ],
              ],
              ")",
            ),
          ],
        ],
        [1, () => parenthesized(["await ", parenthesized(arrow(next, [], [], { isAsync: true })), "()"])],
        [
          1,
          () =>
            parenthesized(
              group(
                "await later",
                list("(", [number(next)], ")"),
                indent(
                  softline,
                  ".then",
                  list("(", [arrow(next, [fresh("value")], [": number"])], ")"),
                  softline,
                  ".catch",
                  list(
                    "(",
                    [
                      [
                        "(error",
                        typed(": unknown"),
                        ")",
                        typed(": number"),
                        " => ",
                        block([
                          [step(literal()), semi],
                          ["throw error", semi],
                        ]),
                      ],
                    ],
                    ")",
                  ),
                  softline,
                  ".finally",
                  list("(", [["() => ", block([[step(literal()), semi]])]], ")"),
                ),
              ),
            ),
        ],
        [
          1,
          () =>
            parenthesized([
              "await Promise.race",
              list("(", [list("[", [["later", list("(", [number(next)], ")")]], "]")], ")"),
            ]),
        ],
        [
          1,
          () => [
            parenthesized([
              "await Promise.allSettled",
              list("(", [list("[", [["later", list("(", [number(next)], ")")], number(next)], "]")], ")"),
            ]),
            ".length",
          ],
        ],
        [1, () => parenthesized(["await new Promise", typed("<number>"), list("(", [promiseExecutor(next)], ")")])],
      );
    }
    if (scope.yields)
      choices.push([
        1,
        () =>
          parenthesized([
            parenthesized(["yield ", number(next)]),
            typed(" as number | undefined"),
            " ?? ",
            number(next),
          ]),
      ]);
    if (isTyped) {
      choices.push(
        [1, () => parenthesized([number(next), " as number"])],
        [1, () => [step(number(next)), "!"]],
        [1, () => parenthesized([number(next), " satisfies number"])],
        [1, () => ["<number>", step(number(next))]],
        [1, () => "Level.High"],
        [1, () => ["Level[", '"Low"', "]"]],
        [1, () => ["Units.scale", list("(", [number(next)], ")")]],
        [1, () => ["Units.Inner.twice", list("(", [number(next)], ")")]],
        [1, () => ["same<number>", list("(", [number(next)], ")")]],
      );
    }
    if (isBroad) {
      const one = () => list("(", [number(next)], ")");
      const two = () => list("(", [number(next), number(next)], ")");
      const either = (test: Doc) =>
        parenthesized(group(test, indent(line, "? ", number(next), line, ": ", number(next))));
      choices.push(
        [1, () => "guarded.size"],
        [1, () => 'guarded["size"]'],
        [1, () => parenthesized(["guarded.size = ", number(next)])],
        [1, () => either('"size" in guarded')],
        [1, () => either("delete guarded.other")],
        [1, () => "Object.keys(guarded).length"],
        [1, () => "({ ...guarded }).size"],
        [1, () => 'Reflect.get(guarded, "size")'],
        [1, () => ["wrapped", one()]],
        [1, () => ["wrapped.call", list("(", ["null", number(next)], ")")]],
        [1, () => ["new Built().add", one(), ".total"]],
        [1, () => "gauge.twice"],
        [1, () => parenthesized(["gauge.twice = ", number(next)])],
        [1, () => parenthesized(["gauge.twice += ", number(next)])],
        [1, () => "gauge.twice++"],
        [1, () => "gauge.reading()"],
        [1, () => ["Texts.tag`a${", number(next), "}b${", number(next), "}`"]],
        [1, () => ["new Texts().label`${", number(next), "}`"]],
        [1, () => ["texts.label`", random.pick(["", "a", "\\n"]), "${", number(next), "}`"]],
        [1, () => ['holder.inner.deep["read"]?.', one()]],
        [1, () => ['holder?.["inner"]?.deep.read?.', one()]],
        [1, () => parenthesized(["holder.missing?.deep?.read?.", one(), " ?? ", number(next)])],
        [1, () => ["sum", list("(", [["[...range", two(), "]"]], ")")]],
        [1, () => ["sum", list("(", [["[...both", one(), "]"]], ")")]],
        [1, () => ["Math.max", list("(", [number(next), ["...range", two()]], ")")]],
        [1, () => ["Array.from", list("(", [["range", two()]], ")"), ".length"]],
        [1, () => parenthesized(["range", two(), ".next().value ?? ", number(next)])],
        [1, () => "sum([...new Bag()])"],
        [1, () => ["Array.from", list("(", ["new Bag()", arrow(next, ["item"], [": number"])], ")"), ".length"]],
        [1, () => ["JSON.stringify", list("(", [["{ toJSON: ", arrow(next, [], []), " }"]], ")"), ".length"]],
        [1, () => ['JSON.parse("[1, 2]", ', arrow(next, ["_key", "_value"], [": string", ": unknown"]), ")"]],
        [1, () => ["[3, 1, 2].sort(", arrow(next, ["left", "right"], [": number", ": number"]), ").length"]],
        [1, () => ["[1, 2].flatMap(", arrowToList(next), ").length"]],
        [1, () => parenthesized(["[1, 2].find(", arrow(next, ["item"], [": number"]), ") ?? ", number(next)])],
        [1, () => either(["[1, 2].some(", arrow(next, ["item"], [": number"]), ")"])],
        [1, () => either(["[1, 2].every(", arrow(next, ["item"], [": number"]), ")"])],
        [1, () => ["+{ [Symbol.toPrimitive]: ", arrow(next, [], []), " }"]],
        [1, () => ["visited", one()]],
      );
      if (!isTyped)
        choices.push(
          [1, () => ["new Legacy", one(), ".read()"]],
          [1, () => ["Legacy.of", one(), ".half"]],
          [1, () => ["new Legacy", one(), ".chainTo", one(), ".value"]],
        );
    }
    return random.weighted(choices)();
  }

  function textArrow(scope: Scope): Doc {
    return ["() => String", list("(", [number(inFunction(scope))], ")")];
  }

  function promiseExecutor(scope: Scope): Doc {
    const body = inFunction(scope);
    const scheduler = random.pick(["setTimeout", "setTimeout", "setImmediate", "queueMicrotask", "process.nextTick"]);
    return [
      "(resolve, reject) => ",
      block([
        [
          scheduler,
          list(
            "(",
            [
              [
                "() => ",
                block([
                  [
                    "try ",
                    block([["resolve", list("(", [number(body)], ")"), semi]]),
                    " catch (error) ",
                    block([["reject(error)", semi]]),
                  ],
                ]),
              ],
              ...(scheduler === "setTimeout" ? ["0"] : []),
            ],
            ")",
          ),
          semi,
        ],
      ]),
    ];
  }

  function pattern(outer: Scope, target: Scope): { pattern: Doc; value: Doc; annotation: string } {
    const scope = inner(outer, { isAsync: false });
    const first = fresh("part");
    const second = fresh("part");
    target.numbers.push(first, second);
    return random.pick<() => { pattern: Doc; value: Doc; annotation: string }>([
      () => ({
        pattern: list("{", [first, [second, " = ", number(scope)]], "}", line),
        value: list("{", [[first, ": ", number(scope)]], "}", line),
        annotation: `: { ${first}: number; ${second}?: number }`,
      }),
      () => ({
        pattern: list("[", [first, [second, " = ", number(scope)]], "]"),
        value: list("[", [number(scope)], "]"),
        annotation: ": number[]",
      }),
      () => ({
        pattern: list(
          "{",
          [
            ["a: ", first],
            ["b: ", list("[", [second], "]")],
          ],
          "}",
          line,
        ),
        value: list(
          "{",
          [
            ["a: ", number(scope)],
            ["b: ", list("[", [number(scope)], "]")],
          ],
          "}",
          line,
        ),
        annotation: ": { a: number; b: number[] }",
      }),
      () => ({
        pattern: list(
          "{",
          [["a: ", list("{", [[first, " = ", number(scope)]], "}", line)], second, ["...", fresh("rest")]],
          "}",
          line,
          true,
        ),
        value: list("{", [["a: {}"], [second, ": ", number(scope)], ["more: ", number(scope)]], "}", line),
        annotation: `: { a: { ${first}?: number }; ${second}: number; more: number }`,
      }),
    ])();
  }

  function statements(scope: Scope, count: number, returns: boolean): Doc[] {
    const result: Doc[] = [];
    for (let index = 0; index < count; index++) {
      if (hasComments && random.chance(0.1)) result.push(`// ${random.pick(notes)}`);
      const made = statement(scope);
      if (made.length) made[made.length - 1] = [made[made.length - 1], trailingNote()];
      result.push(...made);
    }
    if (returns) result.push(group("return ", number(scope), semi));
    return result;
  }

  function statement(scope: Scope): Doc[] {
    const next = inner(scope);
    const nested = (count = random.between(1, 2)) => block(statements(inner(scope), isDeep(scope) ? 1 : count, false));
    const declare = (stem: string, value: Doc, annotation = ": number") => {
      const name = fresh(stem);
      return {
        name,
        text: group(
          random.pick(["const ", "const ", "let "]),
          name,
          random.chance(0.3) ? typed(annotation) : "",
          " =",
          indent(line, value),
          semi,
        ),
      };
    };
    const choices: [number, () => Doc[]][] = [
      [
        5,
        () => {
          const made = declare("value", number(next));
          scope.numbers.push(made.name);
          return [made.text];
        },
      ],
      [
        2,
        () => {
          const made = declare("values", listOf(next), ": number[]");
          scope.lists.push(made.name);
          return [made.text];
        },
      ],
      [
        3,
        () => {
          const value = number(next);
          return [
            /^(?:[a-z]\w*[.(?[]|new |\(await )/.test(print(value, 1000))
              ? [semi || !print(value, 1000).startsWith("(") ? "" : ";", value, semi]
              : group("counter.total +=", indent(line, value), semi),
          ];
        },
      ],
      [2, () => [["if (", number(next), ") ", nested(), random.chance(0.5) ? [" else ", nested()] : ""]]],
      [
        2,
        () => {
          const name = fresh("item");
          const body = inner(scope);
          body.numbers.push(name);
          return [["for (const ", name, " of ", listOf(next), ") ", block(statements(body, 1, false))]];
        },
      ],
      [
        1,
        () => {
          const key = fresh("name");
          const value = fresh("entry");
          const body = inner(scope);
          body.numbers.push(value);
          return [
            [
              "for (const [",
              key,
              ", ",
              value,
              "] of Object.entries",
              list("(", [record(next)], ")"),
              ") ",
              block(statements(body, 1, false)),
            ],
          ];
        },
      ],
      [
        1,
        () => {
          const name = fresh("index");
          const body = inner(scope);
          body.numbers.push(name);
          return [
            [
              "for (let ",
              name,
              " = ",
              number(next),
              " * 0; ",
              name,
              " < ",
              step("2"),
              "; ",
              name,
              "++) ",
              block(statements(body, 1, false)),
            ],
          ];
        },
      ],
      [1, () => [["for (const ", fresh("name"), " in ", record(next), ") ", nested(1)]]],
      [
        1,
        () => {
          const name = fresh("turns");
          return [`let ${name} = 0${semi}`, ["while (", name, "++ < ", step("2"), ") ", nested(1)]];
        },
      ],
      [
        1,
        () =>
          scope.isStaticBlock
            ? []
            : [
                [
                  "switch (",
                  number(next),
                  " % 2) ",
                  "{",
                  indent(
                    hardline,
                    "case ",
                    step("0"),
                    ":",
                    indent(
                      statements(inner(scope), 1, false).map(text => [hardline, text]),
                      hardline,
                      ["break", semi],
                    ),
                    hardline,
                    "default:",
                    indent(statements(inner(scope), 1, false).map(text => [hardline, text])),
                  ),
                  hardline,
                  "}",
                ],
              ],
      ],
      [
        2,
        () => [
          [
            "try ",
            nested(),
            random.pick<() => Doc>([
              () => [
                " catch (error) ",
                block([
                  [step(literal()), semi],
                  ["throw error", semi],
                ]),
              ],
              () => [" catch (error) ", block([["seen", list("(", ["error"], ")"), semi]])],
              () => [
                " catch ",
                block([["throw new Error", list("(", [["`again ${", number(next), "}`"]], ")"), semi]]),
              ],
              () => [" finally ", nested(1)],
              () => [" catch (error) ", block([["throw error", semi]]), " finally ", nested(1)],
            ])(),
          ],
        ],
      ],
      [
        2,
        () => {
          const made = pattern(next, scope);
          return [
            group(
              random.pick(["const ", "let "]),
              made.pattern,
              random.chance(0.3) ? typed(made.annotation) : "",
              " = ",
              made.value,
              semi,
            ),
          ];
        },
      ],
      [
        2,
        () => {
          if (!shapes.length) return [];
          const shape = random.pick(shapes);
          const typeName = shape.typeName === undefined ? shape.name : shape.typeName;
          const made = declare("object", construct(next, shape), typeName === null ? "" : `: ${typeName}`);
          scope.objects.push({ name: made.name, shape });
          return [made.text];
        },
      ],
      [
        2,
        () => {
          // A function in a variable, called twice or once.
          const isOnce = random.chance(0.5);
          const name = fresh(isOnce ? "onceLocal" : "local");
          const parameter = fresh("given");
          const value = random.chance(0.5)
            ? arrow(next, [parameter], [": number"])
            : [
                "function (",
                parameter,
                typed(": number"),
                ") ",
                block(
                  statements(
                    inFunction(next, { self: null, numbers: [...next.numbers, parameter] }),
                    random.between(0, 1),
                    true,
                  ),
                ),
              ];
          const call = (): Doc => [name, list("(", [number(next)], ")")];
          const use = fresh("value");
          scope.numbers.push(use);
          return [
            group("const ", name, " = ", value, semi),
            group("const ", use, " = ", isOnce ? call() : [call(), " + ", call()], semi),
          ];
        },
      ],
      [
        2,
        () => {
          // A function that a block or a body declares, called twice or once.
          const isOnce = random.chance(0.5);
          const name = fresh(isOnce ? "onceDeclared" : "declared");
          const parameter = fresh("given");
          const declaration: Doc = [
            "function ",
            name,
            "(",
            parameter,
            typed(": number"),
            ")",
            typed(": number"),
            " ",
            block(
              statements(
                inFunction(next, { self: null, numbers: [...next.numbers, parameter] }),
                random.between(0, 1),
                true,
              ),
            ),
          ];
          const call = (): Doc => [name, list("(", [number(next)], ")")];
          const use: Doc = [step(isOnce ? call() : [call(), " + ", call()]), semi];
          const both = random.chance(0.3) ? [use, declaration] : [declaration, use];
          return random.chance(0.6) ? [block(both)] : both;
        },
      ],
      [1, () => [[random.pick(["counter.total += ", "counter.total = ", 'counter["total"] -= ']), number(next), semi]]],
      [
        1,
        () => {
          if (scope.isStaticBlock) return [];
          const label = fresh("label");
          return [
            [
              label,
              ": ",
              block([["if (", number(next), ") break ", label, semi], ...statements(inner(scope), 1, false)]),
            ],
          ];
        },
      ],
      [1, () => (isDeep(scope) ? [] : localClass(scope))],
      [2, () => (isDeep(scope) ? [] : localObject(scope))],
      [
        1,
        () => {
          const first = fresh("part");
          const second = fresh("part");
          const body = inner(scope);
          body.numbers.push(first, second);
          const isList = random.chance(0.5);
          const one = (): Doc =>
            isList ? list("[", [number(next)], "]") : list("{", [[first, ": ", number(next)]], "}", line);
          const head = isList
            ? list("[", [first, [second, " = ", number(next)]], "]")
            : list("{", [first, [second, " = ", number(next)]], "}", line);
          const annotation = isList ? "" : typed(` as { ${first}: number; ${second}?: number }[]`);
          return [
            [
              "for (const ",
              head,
              " of ",
              list("[", [one(), one()], "]"),
              annotation,
              ") ",
              block(statements(body, 1, false)),
            ],
          ];
        },
      ],
      [
        1,
        () => {
          const key = fresh("key");
          const value = fresh("value");
          const body = inFunction(scope);
          body.numbers.push(key, value);
          const map: Doc = [
            "new Map",
            list("(", [list("[", [list("[", [number(next), number(next)], "]")], "]")], ")"),
          ];
          return random.chance(0.5)
            ? [[map, ".forEach", list("(", [[`(${value}, ${key}) => `, block(statements(body, 1, false))]], ")"), semi]]
            : [
                [
                  "for (const [",
                  key,
                  ", ",
                  value,
                  "] of ",
                  map,
                  ") ",
                  block(statements(inner(scope, { numbers: body.numbers }), 1, false)),
                ],
              ];
        },
      ],
      [
        1,
        () => {
          const object = scope.objects.find(object =>
            object.shape.members.some(member => member.kind === "getter" && !member.isStatic),
          );
          if (!object) return [];
          const getter = object.shape.members.find(member => member.kind === "getter" && !member.isStatic)!;
          const name = fresh("read");
          scope.numbers.push(name);
          return [["const { ", getter.name, ": ", name, " } = ", object.name, semi]];
        },
      ],
    ];
    if (scope.isAsync) {
      choices.push(
        [
          2,
          () => {
            const name = fresh("item");
            const body = inner(scope);
            body.numbers.push(name);
            return [
              [
                "for await (const ",
                name,
                " of ",
                random.chance(0.5)
                  ? ["stream", list("(", [number(next)], ")")]
                  : list("[", [["later", list("(", [number(next)], ")")], number(next)], "]"),
                ") ",
                block(statements(body, 1, false)),
              ],
            ];
          },
        ],
        [1, () => [["await ", "later", list("(", [number(next)], ")"), semi]]],
      );
    }
    if (scope.yields)
      choices.push([2, () => [["yield ", number(next), semi]]], [1, () => [["yield* ", listOf(next), semi]]]);
    if (isTyped) {
      choices.push(
        [1, () => [`type ${fresh("Alias")} = { size: number }${semi}`]],
        [1, () => [[`interface ${fresh("Contract")} {`, indent(hardline, "size: number;"), hardline, "}"]]],
        [
          1,
          () => {
            const name = fresh("Kind");
            const use = fresh("value");
            // Bun's transpiler wraps an enum in a function, which has a frame of its own under `bun run`. So no member calls anything.
            const first = isWide
              ? number(inner(scope, { isAsync: false, yields: false, self: null }))
              : scope.numbers.length
                ? random.pick(scope.numbers)
                : literal();
            scope.numbers.push(use);
            return [
              [
                "enum ",
                name,
                " {",
                indent(
                  hardline,
                  "First = ",
                  first,
                  ",",
                  hardline,
                  "Second = ",
                  random.pick(['"ab".length', "First + 1", literal()]),
                  ",",
                ),
                hardline,
                "}",
              ],
              `const ${use} = ${name}.First + ${name}.Second${semi}`,
            ];
          },
        ],
      );
    }
    return random.weighted(choices)();
  }

  function parametersOf(outer: Scope, body: Scope, target: Callable): Doc {
    const parts: Doc[] = [];
    // Under `bun run` the stack of what the parameters of an async function throw lacks the function.
    const isQuiet = target.isAsync && !isWide;
    const initial = () => (isQuiet ? literal() : number(outer));
    for (let index = 0; index < target.arity; index++) {
      const name = fresh("given");
      if (index === target.arity - 1 && target.recordKey !== null) {
        const key = target.recordKey;
        parts.push([list("{", [[key, " = ", initial()]], "}", line), typed(`: { ${key}?: number }`)]);
        body.numbers.push(key);
      } else if (random.chance(0.25)) {
        parts.push([name, typed(": number"), " = ", initial()]);
        body.numbers.push(name);
      } else {
        parts.push([name, typed(": number")]);
        body.numbers.push(name);
      }
    }
    return list("(", parts, ")");
  }

  function functionBody(scope: Scope): Doc {
    return block(statements(scope, random.between(0, 3), true));
  }

  function classText(scope: Scope, shape: Shape, base: Shape | null, head: Doc): Doc {
    const members: Doc[] = [];
    const own = (changes: Partial<Scope> = {}) =>
      inFunction(scope, { self: { ...shape, members: [], base: null }, isStaticSelf: false, ...changes });
    const declared: Member[] = [];
    const visible = (isStatic: boolean, changes: Partial<Scope> = {}) =>
      own({ self: { ...shape, members: [...declared], base }, isStaticSelf: isStatic, ...changes });
    members.push(["size", typed(": number"), " = ", number(own()), ";"]);
    if (random.chance(0.4)) members.push(["#hidden", typed(": number"), " = ", number(own()), ";"]);
    if (random.chance(0.4))
      members.push(["static count", typed(": number"), " = ", number(own({ isStaticSelf: true })), ";"]);
    // A class may leave its constructor to the language.
    if (shape.arity !== (base ? base.arity : 0) || random.chance(0.6) || (isTyped && base?.isAny && base.arity > 0)) {
      const body = own();
      const parts: Doc[] = [];
      for (let index = 0; index < shape.arity; index++) {
        const name = fresh("given");
        body.numbers.push(name);
        const modifier =
          isTyped && random.chance(0.4) ? random.pick(["private ", "public ", "readonly ", "protected readonly "]) : "";
        parts.push([modifier, name, typed(": number"), random.chance(0.2) ? [" = ", number(own())] : ""]);
      }
      const text = statements(body, random.between(0, 2), false);
      if (base) text.unshift(["super", args(own({ self: null }), base.arity), semi]);
      members.push(["constructor", list("(", parts, ")"), " ", block(text)]);
    }
    for (const member of shape.members) {
      const body = visible(member.isStatic, { isAsync: member.isAsync, yields: member.yields });
      const prefix = [member.isStatic ? "static " : "", member.isAsync ? "async " : "", member.yields ? "*" : ""].join(
        "",
      );
      const returns = member.yields
        ? member.isAsync
          ? ": AsyncGenerator<number>"
          : ": Generator<number>"
        : member.isAsync
          ? ": Promise<number>"
          : ": number";
      if (member.isArrow) {
        members.push([
          member.name,
          " = ",
          member.isAsync ? "async " : "",
          parametersOf(visible(false), body, member),
          " => ",
          functionBody(body),
          ";",
        ]);
      } else if (member.kind === "getter")
        members.push([prefix, "get ", member.name, "()", typed(": number"), " ", functionBody(body)]);
      else if (member.kind === "setter") {
        const name = fresh("given");
        body.numbers.push(name);
        members.push([
          prefix,
          "set ",
          member.name,
          "(",
          name,
          typed(": number"),
          ") ",
          block(statements(body, random.between(1, 2), false)),
        ]);
      } else {
        members.push([
          prefix,
          member.name,
          parametersOf(visible(member.isStatic), body, member),
          random.chance(0.5) ? typed(returns) : "",
          " ",
          member.yields ? block(statements(body, random.between(1, 3), false)) : functionBody(body),
        ]);
      }
      declared.push(member);
    }
    if (random.chance(0.4))
      members.push(["static ", block(statements(visible(true, { isStaticBlock: true }), random.between(1, 2), false))]);
    return [
      head,
      base ? [" extends ", base.name] : "",
      " {",
      indent(members.map((member, index) => [index ? hardline : "", hardline, member])),
      hardline,
      "}",
    ];
  }

  function makeShape(stem: string, isClass = true): Shape {
    const members: Member[] = [];
    for (let index = random.between(1, 4); index > 0; index--) {
      const kind = random.weighted<Member["kind"]>([
        [5, "method"],
        [2, "getter"],
        [1, "setter"],
      ]);
      const isPlain = kind !== "method";
      const arity = isPlain ? 0 : random.between(0, 2);
      const isArrow = !isPlain && random.chance(0.15);
      const isAsync = !isPlain && random.chance(0.25);
      members.push({
        kind,
        isArrow,
        name:
          (kind === "method" && !isArrow && isClass && random.chance(0.15) ? "#" : "") +
          fresh(kind === "method" ? "run" : kind === "getter" ? "current" : "next"),
        arity,
        recordKey: arity && random.chance(0.25) ? fresh("option") : null,
        isAsync,
        yields: !isPlain && !isArrow && random.chance(0.15) && (isWide || !isAsync),
        isStatic: isClass && !isArrow && random.chance(0.2),
      });
    }
    return { name: fresh(stem), arity: random.between(0, 2), members, base: null };
  }

  const reachable = (shape: Shape): Shape => ({
    ...shape,
    members: shape.members.filter(member => !member.name.startsWith("#")),
  });

  // An object literal with methods, which read each other through `this`.
  function localObject(scope: Scope): Doc[] {
    const shape = makeShape("service", false);
    const declared: Member[] = [];
    const parts: Doc[] = [["size: ", number(inner(scope))]];
    for (const member of shape.members) {
      const isOwnThis = !member.isArrow;
      const body = inFunction(inner(scope), {
        isAsync: member.isAsync,
        yields: member.yields,
        ...(isOwnThis ? { self: { ...shape, members: [...declared] }, isStaticSelf: false } : {}),
      });
      const outside = inFunction(inner(scope), isOwnThis ? { self: null } : {});
      const prefix = [member.isAsync ? "async " : "", member.yields ? "*" : ""].join("");
      if (member.isArrow)
        parts.push([member.name, ": ", prefix, parametersOf(outside, body, member), " => ", functionBody(body)]);
      else if (member.kind === "getter")
        parts.push(["get ", member.name, "()", typed(": number"), " ", functionBody(body)]);
      else if (member.kind === "setter") {
        const name = fresh("given");
        body.numbers.push(name);
        parts.push(["set ", member.name, "(", name, typed(": number"), ") ", block(statements(body, 1, false))]);
      } else {
        const returns = member.yields
          ? member.isAsync
            ? ": AsyncGenerator<number>"
            : ": Generator<number>"
          : member.isAsync
            ? ": Promise<number>"
            : ": number";
        parts.push([
          prefix,
          member.name,
          parametersOf(outside, body, member),
          typed(returns),
          " ",
          member.yields ? block(statements(body, random.between(1, 2), false)) : functionBody(body),
        ]);
      }
      declared.push(member);
    }
    scope.objects.push({ name: shape.name, shape });
    return [["const ", shape.name, " = {", indent(parts.map(part => [hardline, part, ","])), hardline, "}", semi]];
  }

  function localClass(scope: Scope): Doc[] {
    const shape = makeShape("Local");
    const base = shapes.length && random.chance(0.4) ? random.pick(shapes) : null;
    const text = classText(inner(scope), shape, base, ["class ", shape.name]);
    const name = fresh("object");
    const made = construct(inner(scope), shape);
    scope.objects.push({ name, shape: reachable(shape) });
    return [text, group("const ", name, " = ", made, semi)];
  }

  const top: Scope = {
    numbers: [],
    lists: [],
    objects: [],
    self: null,
    isStaticSelf: false,
    isStaticBlock: false,
    isAsync: false,
    yields: false,
    depth: 0,
  };
  const parts: Doc[] = [];
  const exports: Exported[] = [];
  // What the end of the file exports: `[its name in the file, the name that another file asks for]`.
  const listed: [string, string][] = [];
  let hasDefault = false;
  const listsAtEnd = part ? random.chance(0.3) : false;
  // How a declaration at the top of one file of several reaches the others. `head` stands ahead of `function`, `class` or the arrow, `tail` behind the
  // declaration, and `local` is how the file itself writes the name.
  function exportOf(name: string, kind: "function" | "arrow" | "class") {
    const plain = { head: kind === "arrow" ? `const ${name} = ` : "", tail: [] as Doc[], local: name, isNamed: true };
    const as = random.chance(0.2) ? fresh(kind === "class" ? "Renamed" : "renamed") : name;
    const later = () => (listed.push([name, as]), { ...plain, exportedAs: as });
    if (listsAtEnd) return later();
    if (!isCommonJs) {
      return random.weighted<() => typeof plain & { exportedAs: string }>([
        [4, () => ({ ...plain, head: "export " + plain.head, exportedAs: name })],
        [
          hasDefault ? 0 : 2,
          () => (
            (hasDefault = true),
            kind === "arrow"
              ? { ...plain, tail: [`export default ${name}${semi}`], exportedAs: "default" }
              : {
                  ...plain,
                  head: "export default ",
                  exportedAs: "default",
                  isNamed: !(part?.mayOmitNames && random.chance(0.5)),
                }
          ),
        ],
        [2, later],
      ])();
    }
    const holder = random.pick(["exports", "exports", "module.exports"]);
    return random.weighted<() => typeof plain & { exportedAs: string }>([
      [3, () => ({ ...plain, tail: [`${holder}.${as} = ${name}${semi}`], exportedAs: as })],
      [
        2,
        () => ({
          head: `${holder}.${name} = `,
          tail: [],
          local: `${holder}.${name}`,
          isNamed: false,
          exportedAs: name,
        }),
      ],
      [
        kind === "arrow" ? 0 : 2,
        () => ({ head: `${holder}.${name} = `, tail: [], local: `${holder}.${name}`, isNamed: true, exportedAs: name }),
      ],
      [
        1,
        () => ({
          ...plain,
          tail: [
            `Object.defineProperty(exports, "${as}", {\n  enumerable: true,\n  get: function () {\n    return ${name};\n  },\n})${semi}`,
          ],
          exportedAs: as,
        }),
      ],
    ])();
  }

  const declarations =
    part?.role === "helpers" ? 0 : part?.role === "loaded" ? random.between(0, 2) : random.between(3, 6);
  for (let index = declarations; index > 0; index--) {
    if (random.chance(0.35)) {
      // Only its methods run more than once.
      const shape = makeShape("Model");
      const base = shapes.length && random.chance(0.4) ? random.pick(shapes) : null;
      if (part && part.role !== "main") {
        const form = exportOf(shape.name, "class");
        const isExpression = form.local !== shape.name;
        parts.push(
          [
            classText(inner(top, { depth: 2 }), shape, base, [
              form.head,
              "class",
              form.isNamed ? " " + shape.name : "",
            ]),
            isExpression ? semi : "",
          ],
          ...form.tail,
        );
        if (form.isNamed || isExpression) shapes.push({ ...reachable(shape), name: form.local });
        exports.push({ exportedAs: form.exportedAs, shape: reachable(shape) });
        continue;
      }
      parts.push(
        classText(inner(top, { depth: 2 }), shape, base, [
          random.chance(0.2) && !isCommonJs ? "export " : "",
          "class ",
          shape.name,
        ]),
      );
      shapes.push(reachable(shape));
      continue;
    }
    const arity = random.between(0, 3);
    const isAsync = random.chance(0.3);
    const target: Callable = {
      name: fresh("work"),
      arity,
      recordKey: arity && random.chance(0.25) ? fresh("option") : null,
      isAsync,
      yields: random.chance(0.15) && (isWide || !isAsync),
    };
    const body = inFunction(inner(top, { depth: 1 }), { isAsync: target.isAsync, yields: target.yields });
    const parameters = parametersOf(inner(top, { depth: 3 }), body, target);
    const text = target.yields ? block(statements(body, random.between(1, 3), false)) : functionBody(body);
    const asArrow = !target.yields && random.chance(0.3);
    const form = part && part.role !== "main" ? exportOf(target.name, asArrow ? "arrow" : "function") : null;
    const exported = form
      ? form.local === target.name
        ? form.head
        : ""
      : random.chance(0.15) && !isCommonJs
        ? "export "
        : "";
    const isReachable = !form || form.isNamed || form.local !== target.name;
    if (
      isReachable &&
      isTyped &&
      !asArrow &&
      !target.yields &&
      !target.isAsync &&
      target.arity === 1 &&
      target.recordKey === null &&
      random.chance(0.5)
    )
      parts.push(`${exported}function ${target.name}(given: number): number;`);
    parts.push(
      asArrow
        ? [
            form ? form.head : ["const ", target.name, " = "],
            target.isAsync ? "async " : "",
            parameters,
            " => ",
            text,
            semi,
          ]
        : [
            form ? form.head : exported,
            target.isAsync ? "async " : "",
            "function",
            target.yields ? "*" : "",
            !form || form.isNamed ? " " + target.name : target.yields ? "" : " ",
            parameters,
            " ",
            text,
            form && form.local !== target.name ? semi : "",
          ],
      ...(form?.tail ?? []),
    );
    if (isReachable) functions.push(form ? { ...target, name: form.local } : target);
    if (form) exports.push({ exportedAs: form.exportedAs, callable: target });
  }

  const scenarios: string[] = [];
  for (let index = part && part.role !== "main" ? 0 : random.between(2, 4); index > 0; index--) {
    const name = fresh("scenario");
    const isAsync = random.chance(0.5);
    scenarios.push(name);
    parts.push([
      isAsync ? "async " : "",
      "function ",
      name,
      "() ",
      block(statements(inner(top, { isAsync }), random.between(2, 5), true)),
    ]);
  }

  const any = typed(": any");
  const calls = part ? "state.calls" : "calls";
  const failing = part ? "state.failing" : "failing";
  const [thrower, helpers] = random.pick([
    [`throw new Error("step " + ${calls});`, ""],
    [`throw new Error("step " + ${calls});`, ""],
    [
      `throw new StepError(${calls});`,
      `class StepError extends Error {
  constructor(count${typed(": number")}) {
    super("step " + count);
    this.name = "StepError";
  }
}
`,
    ],
    [
      `throw new StepError(${calls});`,
      `class StepError extends Error {
  constructor(count${typed(": number")}) {
    super("step " + count);
    Error.captureStackTrace(this, StepError);
  }
}
`,
    ],
    [
      `refuse(${calls});`,
      `function refuse(count${typed(": number")})${typed(": never")} {
  throw new RangeError("step " + count);
}
`,
    ],
    ["nothing.missing;", `const nothing${any} = null;\n`],
    ["nothing();", `const nothing${any} = undefined;\n`],
  ]);
  const more = `const guarded${typed(": Record<string, number>")} = new Proxy(
  { size: 1 }${typed(" as Record<string, number>")},
  {
    get(target, key, receiver) {
      return step(Reflect.get(target, key, receiver));
    },
    set(target, key, value, receiver) {
      return Reflect.set(target, key, step(value), receiver);
    },
    has(target, key) {
      return step(key in target);
    },
    ownKeys(target) {
      return step(Reflect.ownKeys(target));
    },
    getOwnPropertyDescriptor(target, key) {
      return step(Reflect.getOwnPropertyDescriptor(target, key));
    },
    deleteProperty(target, key) {
      return step(Reflect.deleteProperty(target, key));
    },
  },
);
const wrapped = new Proxy(
  function (value${typed(": number")}) {
    return step(value);
  },
  {
    apply(target, self, given) {
      return step(Reflect.apply(target, self, given));
    },
  },
);
const Built = new Proxy(Chain, {
  construct(target, given, newTarget) {
    step(given.length);
    return Reflect.construct(target, given, newTarget);
  },
});
const gauge${typed(": { level: number; twice: number; reading(): number }")} = Object.create(
  Object.defineProperties(
    {},
    {
      twice: {
        get(${typed("this: { level: number }")}) {
          return step(this.level) * 2;
        },
        set(${typed("this: { level: number }, ")}value${typed(": number")}) {
          this.level = step(value) % 7;
        },
      },
      reading: {
        value(${typed("this: { level: number }")}) {
          return step(this.level);
        },
      },
    },
  ),
);
gauge.level = 1;
class Texts {
  static tag(_texts${typed(": TemplateStringsArray")}, ...values${typed(": number[]")}) {
    return step(values.length);
  }
  label(texts${typed(": TemplateStringsArray")}, ...values${typed(": number[]")}) {
    return step(texts.raw.length + values.length);
  }
}
const texts = new Texts();
function* range(from${typed(": number")}, to${typed(": number")})${typed(": Generator<number, undefined>")} {
  for (let value = from % 5; value < (from % 5) + (to % 3); value++) yield step(value);
}
function* both(value${typed(": number")})${typed(": Generator<number, number>")} {
  yield* range(value, 2);
  return step(value);
}
class Bag {
  items = [1, 2];
  *[Symbol.iterator]() {
    for (const item of this.items) yield step(item);
  }
}
function visited(value${typed(": number")}) {
  let result = 0;
  new Map([[1, value]]).forEach(entry => {
    result += step(entry);
  });
  new Set([value]).forEach(entry => {
    result += step(entry);
  });
  return result;
}
${isTyped || part ? "" : constructorFunction}`;
  const prelude = `${isCommonJs ? 'const { EventEmitter } = require("node:events");' : 'import { EventEmitter } from "node:events";'}

${part ? "Error.stackTraceLimit = 50;\nconst state = { calls: 0, failing: 0 };" : "let calls = 0;\nlet failing = 0;"}
${helpers}function step${typed("<T>")}(value${typed(": T")})${typed(": T")} {
  if (++${calls} === ${failing}) ${thrower}
  return value;
}
class Chain {
  total = 0;
  add(value${typed(": number")}) {
    this.total += step(value);
    return this;
  }
  get done() {
    return step(this.total);
  }
  end() {
    return this.total;
  }
}
function emitted(value${typed(": number")}, listener${typed(": (value: number) => number")}) {
  const emitter = new EventEmitter();
  let result = 0;
  emitter.on("value", (given${typed(": number")}) => {
    result = listener(given);
  });
  emitter.emit("value", value);
  return result;
}
function framesOf(error${any})${typed(": string")} {
  return String(error.stack)
    .split("\\n")
    .map(text => /^\\s*at (.*?) ?\\(?[^ ()]*${part ? "[\\\\/]([\\w-]+)\\.[cm]" : "main\\.c"}?[jt]s:(\\d+):(\\d+)\\)?$/.exec(text))
    .filter(found => found !== null)
    .map(found => found[1].replace(/^(new |async )?(<anonymous>|[oO]nce[A-Z]\\w*${part?.mayOmitNames ? "|default|starDefault|\\w+_default" : ""})$/, "$1") + "@" + found[2] + ":" + found[3]${part ? ' + ":" + found[4]' : ""})
    .join(" < ");
}
const caught${typed(": string[]")} = [];
function seen(error${any}) {
  caught.push(framesOf(error));
}
const sum = (values${typed(": number[]")}) => values.reduce((left, right) => left + right, 0);
const pick = (from${typed(": Record<string, number>")}) => sum(Object.values(from));
const tag = (_texts${typed(": TemplateStringsArray")}, ...values${typed(": number[]")}) => step(sum(values));
const maybe${typed(": ((value: number) => number) | undefined")} = value => step(value);
const later = (value${typed(": number")}) => new Promise${typed("<number>")}(resolve => setTimeout(resolve, 0, value));
const counter = { total: 0 };
${typed("const same = <T,>(value: T): T => step(value);\n")}
const holder${typed(": { inner: { deep: { read(value: number): number } }; missing?: { deep: { read(value: number): number } } }")} = {
  inner: {
    deep: {
      read(value${typed(": number")}) {
        return step(value);
      },
    },
  },
};
${isBroad ? more : ""}async function* stream(value${typed(": number")}) {
  yield step(value);
  yield await later(step(value));
}
async function total(values${typed(": AsyncIterable<number>")}) {
  let result = 0;
  for await (const value of values) result += value;
  return result;
}
${typed(`enum Level {
  Low,
  High = 4,
}
namespace Units {
  export function scale(value: number): number {
    return step(value) * 2;
  }
  export namespace Inner {
    export const twice = (value: number) => scale(step(value));
  }
}
`)}`;
  const driver = `${part?.loads ?? ""}for (const scenario of [${scenarios.join(", ")}]) {
  ${failing} = 0;
  ${calls} = 0;
  await scenario();
  const all = ${calls};
  for (${failing} = 1; ${failing} <= all; ${failing}++) {
    ${calls} = 0;
    caught.length = 0;
    try {
      await scenario();
      console.log(scenario.name, ${failing}, "returns", caught.join(" | "));
    } catch (error) {
      console.log(scenario.name, ${failing}, framesOf(error), caught.join(" | "));
    }
  }
}
`;
  const mayAwait = !isCommonJs && (part?.mayAwait ?? true);
  // Code at the top of the module runs once, so each block has one call that throws.
  const blocks = !part
    ? random.between(1, 3)
    : part.role === "main" || part.role === "library"
      ? random.between(0, 2)
      : 0;
  for (let index = blocks; index > 0; index--) {
    const label = fresh("top");
    parts.push([
      `${failing} = ${random.between(1, 8)};`,
      hardline,
      `${calls} = 0;`,
      hardline,
      "try ",
      // While a file waits, the files beside it run.
      block(statements(inner(top, { isAsync: mayAwait && part?.role !== "library" }), random.between(2, 4), false)),
      " catch (error) ",
      block([`console.log("${label}", framesOf(error));`]),
      part ? [hardline, `${failing} = 0;`] : "",
    ]);
  }
  const runs = isCommonJs ? `(async function main() {\n${driver.replace(/^(?=.)/gm, "  ")}})();\n` : driver;
  const ended = (text: string) => (random.chance(0.06) ? text.replace(/\n/g, "\r\n") : text);
  if (!part) return { text: ended(prelude + print(join(parts, [hardline, hardline]), width) + "\n\n" + runs), exports };

  if (part.role === "helpers") {
    for (const name of helperNames(isTyped, isBroad)) listed.push([name, name]);
  }
  if (part.role === "loaded") {
    const scope = inner(top, { isAsync: mayAwait });
    parts.push(...statements(scope, random.between(1, 3), false));
    const value = number(inner(scope));
    parts.push(
      isCommonJs
        ? [random.pick(["module.exports = ", "exports.value = ", "module.exports.value = "]), value, semi]
        : hasDefault || random.chance(0.5)
          ? ["export const ", fresh("value"), " = ", value, semi]
          : ["export default ", value, semi],
    );
  }
  if (listed.length) {
    const names = listed.map(([name, as]) => (name === as ? name : isCommonJs ? `${as}: ${name}` : `${name} as ${as}`));
    const text = [isCommonJs ? "module.exports = " : "export ", list("{", names, "}", line), semi];
    if (!isCommonJs && part.role !== "helpers" && random.chance(0.3)) parts.unshift(text);
    else parts.push(text);
  }
  return {
    text: ended(
      part.heading +
        (part.role === "helpers" ? prelude : "") +
        print(join(parts, [hardline, hardline]), width) +
        "\n" +
        (part.role === "main" ? "\n" + runs : ""),
    ),
    exports,
  };
}
