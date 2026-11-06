// A loop reads and stores variables that are not its own: of the module, of an enclosing function, of a turn of a loop around it, a static member, a field of an object that closures share.
//
//   the variable  let, var, exported, a parameter, a static member, a field; of the module, of the function around the loop, of one turn of an outer loop (let: one for each turn; var: one for all)
//   it holds      whole numbers, also at the end of the 32 bits, fractions, texts, objects, lists, a number or nothing, a number or a text, a truth value, a BigInt, a function
//   a turn        reads it, once or on both sides of other code, in the test of the loop, on one turn only; stores it, by =, +=, ++, a pattern, on some turns, ahead of a break, in a finally
//   who else      a callee, on every turn or on one; a closure made in the loop that runs at once, on a later turn or behind the loop; a getter, a setter, a conversion, a proxy, a default,
//                 a tag, instanceof; a callback of a built-in; a step of a generator; the iterator of the loop; a handler; what runs at an await; whoever takes the steps of the loop's generator
//   the loop      for, while, do while, for of, for in, without a test; upward and downward; inside another with labels; left by break, continue, return and throw; under try and finally
//   it stands     in the function that holds the variable, one or two functions below, in a method, a generator, an async function of which two run at once, at the top of the module
//   who looks     functions in a list of the module read most of the variables: ahead of a loop, in a turn, behind the loop, at the end
//   every third   loop is plain: each turn begins with the variable, the test stands behind the turn, numbers are added up and at most one other comes by
//   then          what every turn saw, the variables behind each loop, and what the closures that were kept see are printed
import type { Random } from "./random";

type Kind = {
  type: string;
  first: (seed: string) => string;
  next: (held: string, by: string) => string;
  show: (held: string) => string;
  size: (held: string) => string;
  steps?: string[];
};
const asItIs = (held: string) => held;
const kinds: Record<string, Kind> = {
  whole: {
    type: "number",
    first: asItIs,
    next: (held, by) => `${held} + ${by} + 1`,
    show: asItIs,
    size: asItIs,
    steps: [
      "HELD += at + 1;",
      "HELD++;",
      "++HELD;",
      "HELD -= at;",
      "HELD += (poke#(1), 1);",
      "HELD ||= at + 1;",
      "HELD &&= HELD + at;",
    ],
  },
  wrapped: {
    type: "number",
    first: seed => `${seed} * 7`,
    next: (held, by) => `(${held} * 31 + ${by}) | 0`,
    show: asItIs,
    size: held => `(${held} & 15)`,
    steps: ["HELD ^= at;", "HELD <<= 1;"],
  },
  fraction: {
    type: "number",
    first: seed => `${seed} + 0.5`,
    next: (held, by) => `${held} * 1.5 + ${by}`,
    show: asItIs,
    size: asItIs,
    steps: ["HELD *= 1.25;", "HELD /= 2;"],
  },
  atTheBorder: {
    type: "number",
    first: seed => `2147483644 + ${seed}`,
    next: (held, by) => `${held} + 1 + (${by} % 2)`,
    show: asItIs,
    size: held => `(${held} - 2147483640)`,
    steps: ["HELD++;", "HELD += 2;"],
  },
  text: {
    type: "string",
    first: seed => `"t" + ${seed}`,
    next: (held, by) => `(${held} + ${by}).slice(-9)`,
    show: asItIs,
    size: held => `${held}.length`,
    steps: ["HELD += at;", 'HELD += (poke#(1), "x");', 'HELD ||= "e";'],
  },
  object: {
    type: "{ value: number }",
    first: seed => `{ value: ${seed} }`,
    next: (held, by) => `{ value: ${held}.value + ${by} + 1 }`,
    show: held => `${held}.value`,
    size: held => `${held}.value`,
    steps: ["HELD.value += at;", "HELD.value++;", "HELD &&= { value: at };"],
  },
  list: {
    type: "number[]",
    first: seed => `[${seed}]`,
    next: (held, by) => `[...${held}.slice(-2), ${by}]`,
    show: held => `${held}.join("+")`,
    size: held => `${held}.length`,
    steps: ["HELD.push(at);", "HELD[0] = at;", "HELD.length = 1;"],
  },
  sometimesNothing: {
    type: "number | undefined",
    first: seed => `orNothing(${seed})`,
    next: (held, by) => `orNothing((${held} ?? 0) + ${by})`,
    show: held => `String(${held})`,
    size: held => `(${held} ?? 0)`,
    steps: ["HELD ??= at;", "HELD &&= at;"],
  },
  eitherKind: {
    type: "number | string",
    first: seed => `eitherKind(${seed})`,
    next: (held, by) => `eitherKind(String(${held}).length + ${by})`,
    show: held => `String(${held})`,
    size: held => `String(${held}).length`,
  },
  flag: {
    type: "boolean",
    first: seed => `${seed} % 2 === 0`,
    next: (held, by) => `!${held} || ${by} % 3 === 0`,
    show: held => `String(${held})`,
    size: held => `(${held} ? 1 : 0)`,
    steps: ["HELD ||= at % 2 === 0;", "HELD &&= at % 2 === 0;"],
  },
  large: {
    type: "bigint",
    first: seed => `BigInt(${seed})`,
    next: (held, by) => `${held} * 3n + BigInt(${by})`,
    show: held => `String(${held})`,
    size: held => `Number(${held} % 7n)`,
    steps: ["HELD++;", "HELD += 2n;"],
  },
  maker: {
    type: "() => number",
    first: seed => `() => ${seed}`,
    next: (held, by) => `((value: number) => () => value)(${held}() + ${by})`,
    show: held => `${held}()`,
    size: held => `${held}()`,
  },
};

// In each text # is the number of the variable. A helper is declared beside its variable where a loop names it.
const helpers: Record<string, string> = {
  poke: "function poke#(by: number): void { HELD = NEXTBY; }",
  peek: 'function peek#(): void { say("peek", SHOW); }',
  far: "function far#(by: number): void { if (by > 90) far#(by - 90); else poke#(by); }",
  probe: "const probe# = { get now(): number { poke#(1); return 1; }, set now(by: number) { poke#(by); } };",
  converter:
    'const converter# = { toString(): string { poke#(2); return "c"; }, valueOf(): number { poke#(3); return 3; } };',
  proxy:
    "const proxy# = new Proxy({} as Record<string, number>, { get(): number { poke#(3); return 3; }, has(): boolean { poke#(4); return true; } });",
  changers: "const changers#: ((by: number) => void)[] = [poke#, () => {}, poke#];",
  stepper:
    "const stepper# = (function* (): Generator<number, void, unknown> { for (let step = 0; ; step++) { poke#(step); yield step; } })();",
  walker:
    "const walker# = { *[Symbol.iterator](): Generator<number, void, unknown> { for (let step = 0; step < 4; step++) { poke#(step); yield step; } } };",
  Checker: "class Checker# { static [Symbol.hasInstance](value: unknown): boolean { poke#(1); return false; } }",
  tag: "function tag#(strings: TemplateStringsArray, by: number): string { poke#(by); return strings[0]; }",
  withDefault: "function withDefault#(by: number = (poke#(5), 5)): number { return by; }",
  later: "async function later#(by: number): Promise<void> { await null; poke#(by); }",
};

const reads = [
  'seen += "," + SHOW;',
  'seen += "," + SHOW;',
  "sum += SIZE;",
  "sum += SIZE;",
  'if (at === K) seen += "," + SHOW;',
  'if (SIZE > K) seen += "+";',
  'seen += "," + SHOW + "/" + SHOW;',
  '{ const before = HELD; OTHER seen += before === HELD ? "=" : "!"; }',
  'seen += "," + SHOW; OTHER seen += "/" + SHOW;',
  "sum += SIZE; OTHER sum += SIZE;",
];
const stores = [
  "HELD = NEXT;",
  "HELD = NEXT;",
  "HELD = NEXT;",
  "STEP",
  "STEP",
  "if (at % 2) HELD = NEXT;",
  "if (at === K) HELD = NEXT;",
  "if (at !== K) STEP",
  "[HELD] = [NEXT];",
  "({ held: HELD } = { held: NEXT });",
  "[HELD = NEXT] = [undefined];",
  "switch (at % 3) { case 0: HELD = NEXT; break; case 1: OTHER default: sum += SIZE; }",
  "HELD = NEXT; OTHER HELD = NEXT;",
  'HELD = NEXT; OTHER seen += "," + SHOW;',
  'seen += "," + SHOW; OTHER HELD = NEXT;',
  "STEP OTHER sum += SIZE;",
];
// Calls whose callee stands in the program.
const callees = [
  "poke#(at);",
  "poke#(at);",
  "peek#();",
  "tell();",
  "if (at === K) tell();",
  "if (at === K) poke#(at);",
  "if (at === K) poke#(at);",
  "if (at === K) peek#();",
  "if (at % 3 === 2) poke#(at);",
  "far#(at);",
  "if (at === K) far#(at);",
  "sum += SIZE + (poke#(at), SIZE);",
  "[at].forEach(by => poke#(by));",
  "[at].forEach(() => peek#());",
  "seen += Array.from({ length: 2 }, (_, index) => (poke#(index), index)).length;",
  "new Map([[1, at]]).forEach(by => poke#(by));",
  "sum += [1, 2].reduce((all, by) => (poke#(by), all + by), 0);",
  "Reflect.apply(poke#, undefined, [at]);",
  "poke#.call(undefined, at);",
  "poke#.bind(undefined, at)();",
  "sum += probe#.now;",
  "probe#.now = at;",
  "changers#[at % 3](at);",
  "seen += tag#`t${at}`;",
  "sum += withDefault#();",
  "if (at === K) sum += withDefault#();",
];
// What the language or a built-in calls by itself.
const calledBack = [
  "seen += [3, 1, 2].sort((x, y) => (poke#(1), x - y))[0];",
  "sum += new Int32Array([2, 1]).sort((x, y) => (poke#(1), x - y))[0];",
  'seen += "x".replace("x", () => (poke#(at), "r"));',
  'seen += "a1".replace(/\\d/, () => (poke#(at), "r"));',
  "seen += JSON.stringify({ toJSON(): number { poke#(at); return 1; } });",
  'sum += JSON.parse("[1]", (_, value) => (poke#(1), value)).length;',
  "seen += JSON.stringify(probe#);",
  "sum += Object.values(probe#)[0];",
  "sum += { ...probe# }.now;",
  "seen += `${converter#}`;",
  "seen += [converter#].join();",
  "sum += Number(converter#);",
  "sum += proxy#.any;",
  'seen += "k" in proxy#;',
  "stepper#.next();",
  "sum += [...walker#].length;",
  "{ const [one] = walker#; sum += one; }",
  "sum += Math.max(...walker#);",
  "seen += ({}) instanceof Checker#;",
  "if (at === K) sum += proxy#.any;",
  "if (at === K) stepper#.next();",
];
const closures = [
  "{ const now = (): void => { HELD = NEXT; }; now(); }",
  "{ const now = (): void => { HELD = NEXT; }; if (at === K) now(); }",
  "kept.push(() => { HELD = NEXT; }); if (at % 2) kept.shift()!();",
  "kept.push(() => { HELD = NEXT; });",
  'kept.push(() => { seen += "," + SHOW; });',
  'kept.push(() => { seen += "," + at; }); if (at === K) kept.pop()!();',
  "takers.push(() => at * 10 + SIZE);",
  '{ const early = (): number => mine; try { sum += early(); } catch { seen += "T"; } let mine = at; sum += early(); mine++; }',
  "{ class Each { static taken = SIZE; read(): number { return SIZE + at; } } takers.push(() => new Each().read() + Each.taken); }",
  "{ let mine = at * 2; takers.push(() => ++mine + SIZE); if (at % 2) sum += takers[takers.length >> 1](); mine += SIZE; }",
  "{ var shared = at * 2; takers.push(() => ++shared + SIZE); if (at % 2) sum += takers[takers.length >> 1](); shared += SIZE; }",
];
const exits = [
  "if (at === K) break;",
  "if (at === K) continue;",
  "if (at === K) { HELD = NEXT; break; }",
  "if (at === K) { HELD = NEXT; continue; }",
  "if (SIZE > 40) break;",
  "block: { if (at === K) break block; HELD = NEXT; }",
];
const handlers = [
  "try { fail(at === K); } catch { poke#(at); }",
  "try { fail(at === K); } catch { peek#(); }",
  'try { fail(at === K); HELD = NEXT; } catch { seen += "," + SHOW; }',
  'try { HELD = NEXT; fail(at === K); HELD = NEXT; } catch { seen += "," + SHOW; } finally { sum += SIZE; }',
  "try { if (at === K) break; } finally { HELD = NEXT; }",
  'try { if (at === K) continue; seen += "," + SHOW; } finally { HELD = NEXT; }',
  'try { try { fail(at === K); } finally { poke#(at); } } catch { seen += "!"; }',
  'try { OTHER fail(at === K); } catch { seen += "," + SHOW; }',
];
const throwsOut = [
  'sum += "ab".repeat(K + 1 - at).length;',
  "sum += new Array(K + 1 - at).length;",
  "sum += (1.5).toFixed(K + 1 - at).length;",
  "fail(at === K + 1);",
  "HELD = NEXT; fail(at === K + 1);",
];
const awaits = [
  "await null;",
  "await null;",
  "queueMicrotask(() => poke#(at)); await null;",
  "await later#(at);",
  "void later#(at); await null;",
  "await Promise.resolve().then(() => poke#(at));",
  "if (at === K) await later#(at);",
  "HELD = await Promise.resolve(NEXT);",
  'seen += "," + (await Promise.resolve(SHOW));',
];
const yields = [
  "yield seen;",
  "yield seen;",
  "if (at === K) yield seen;",
  'HELD = NEXT; yield seen; seen += "," + SHOW;',
];

type Variable = { id: number; kind: Kind; name: string; isOfModule: boolean };

export function generate(random: Random): string {
  let ids = 0;
  let suspendsSomewhere = false;
  const fill = (text: string, { id, kind, name }: Variable) =>
    text
      .replaceAll("NEXTBY", kind.next(name, "by"))
      .replaceAll("NEXTONE", kind.next(name, "1"))
      .replaceAll("NEXT", kind.next(name, "at"))
      .replaceAll("SHOW", kind.show(name))
      .replaceAll("SIZE", kind.size(name))
      .replaceAll("HELD", name)
      .replaceAll("#", String(id))
      .replace(/\bK\b/g, () => String(random.below(4)));
  const helpersOf = (variable: Variable, user: string) => {
    const isNamed = (helper: string) => new RegExp(`\\b${helper}${variable.id}\\b`).test(user);
    const named = Object.keys(helpers).filter(isNamed);
    if (named.some(helper => helper !== "peek") && !named.includes("poke")) named.unshift("poke");
    return named.map(helper => fill(helpers[helper], variable)).join("\n");
  };
  const kindOf = () =>
    kinds[
      random.weighted([
        [5, "whole"],
        [2, "wrapped"],
        [2, "fraction"],
        [2, "atTheBorder"],
        [3, "text"],
        [5, "object"],
        [2, "list"],
        [2, "sometimesNothing"],
        [2, "eitherKind"],
        [1, "flag"],
        [1, "large"],
        [1, "maker"],
      ])
    ];
  /** The variable and how it is declared with a first value. */
  const declared = (forms: string[], isOfModule = false) => {
    const [id, kind] = [++ids, kindOf()];
    const form = random.pick(forms);
    const name = form === "static" ? `Home${id}.held` : form === "field" ? `box${id}.held` : `held${id}`;
    const declare = (seed: string) =>
      form === "static"
        ? `class Home${id} { static held: ${kind.type} = ${kind.first(seed)}; }`
        : form === "field"
          ? `const box${id}: { held: ${kind.type} } = { held: ${kind.first(seed)} };`
          : `${form} ${name}: ${kind.type} = ${kind.first(seed)};`;
    // What a function in a list of the module reads has to be where that function looks for it.
    const handOut = random.chance(0.7) ? `readers.push(() => ${kind.show(name)});` : "";
    return { variable: { id, kind, name, isOfModule }, declare, form, handOut };
  };

  /** One loop with what stands around it. `mayAwait`: the code around it may wait. */
  function stretch(label: string, given: Variable[], mayAwait: boolean) {
    // Every third loop is plain: each turn begins with a variable, which is no field, the test stands behind the turn, the loop adds numbers up, and at most one other comes by.
    const plain = random.chance(0.3);
    const targets = plain
      ? given.toSorted((one, other) => Number(one.name.includes(".")) - Number(other.name.includes(".")))
      : given;
    const place = plain
      ? random.pick(
          targets[0].isOfModule
            ? ["here", "here", "below", "declaredBelow", "method"]
            : ["below", "below", "declaredBelow", "twoBelow", "method"],
        )
      : random.weighted([
          [5, "here"],
          [4, "below"],
          [1, "declaredBelow"],
          [2, "twoBelow"],
          [1, "method"],
          [2, "generator"],
          [mayAwait ? 2 : 0, "async"],
          [mayAwait ? 1 : 0, "hereAndAwaits"],
        ]);
    const suspends =
      place === "generator" ? yields : place === "async" || place === "hereAndAwaits" ? awaits : undefined;
    const isInItsOwnFunction = place !== "here" && place !== "hereAndAwaits";
    const target = () => (random.chance(0.7) ? targets[0] : random.pick(targets));
    // Nobody else comes by, one other comes by, or anything happens.
    const mood = plain
      ? random.pick(["bare", "oneOther"])
      : random.weighted([
          [4, "bare"],
          [5, "oneOther"],
          [5, "anything"],
        ]);
    const quiet = mood !== "anything";
    let leavesByThrow = false;
    const form = plain
      ? random.pick(["testedBehind", "testedBehind", "testedBehind", "testedAtTheEnd", "asLongAsTheVariableSays"])
      : random.weighted([
          [5, "counted"],
          [2, "countedByVar"],
          [1, "downward"],
          [3, "tested"],
          [9, "testedBehind"],
          [3, "testedAtTheEnd"],
          [2, "overAList"],
          [1, "overKeys"],
          [1, "withoutATest"],
          [4, "asLongAsTheVariableSays"],
          [1, "overAWalker"],
          [2, "insideAnother"],
          [1, "overEntries"],
          [1, "withAClosureInItsHead"],
          [1, "withAClosureInItsTest"],
          [1, "withAClosureInItsStep"],
        ]);
    const silent = plain || (mood === "bare" && random.chance(0.6));
    const unlessSilent = (texts: string[]) => (silent ? texts.filter(text => !text.includes("seen")) : texts);
    const passerBy = () => random.pick(random.chance(0.5) ? callees : calledBack);
    const other = (): string => (quiet ? "" : fill(passerBy(), target()));
    const part = (depth: number): string => {
      const drawn = random.weighted<() => string>([
        [6, () => random.pick(unlessSilent(reads))],
        [6, () => random.pick(unlessSilent(stores))],
        [quiet ? 0 : 3, () => "OTHER"],
        [quiet ? 1 : 2, () => random.pick(exits)],
        [quiet ? 0 : 2, () => random.pick(handlers)],
        [quiet ? 0 : 2, () => random.pick(closures)],
        [quiet || leavesByThrow ? 0 : 1, () => ((leavesByThrow = true), random.pick(throwsOut))],
        [suspends ? 4 : 0, () => random.pick(suspends!)],
        [
          isInItsOwnFunction ? 1 : 0,
          () => random.pick(["if (at === K) return;", "if (at === K) { HELD = NEXT; return; }"]),
        ],
        [
          form === "insideAnother" ? 3 : 0,
          () => random.pick(["if (at === K) continue outer;", "if (at === K) break outer;"]),
        ],
        [
          form.startsWith("counted") || form === "withoutATest" ? 1 : 0,
          () => "{ const skip = (): void => { at++; }; if (at === K) skip(); }",
        ],
        [depth ? 0 : 1, () => `for (let inner = 0; inner < ${random.between(1, 3)}; inner++) { ${part(1)} }`],
      ])();
      const variable = target();
      return fill(
        drawn.replaceAll("STEP", () => random.pick(variable.kind.steps ?? ["HELD = NEXT;"])).replaceAll("OTHER", other),
        variable,
      );
    };
    const parts = Array.from({ length: random.between(1, quiet ? 3 : 5) }, () => part(0));
    // A turn that begins with the variable, ahead of every test.
    if (plain || random.chance(0.6))
      parts.unshift(
        fill(
          random.pick(unlessSilent(["HELD = NEXT;", "HELD = NEXT;", "sum += SIZE;", 'seen += "," + SHOW;'])),
          targets[0],
        ),
      );
    if (mood === "oneOther") {
      const drawn = random.weighted<() => string>([
        [8, passerBy],
        [2, () => random.pick(closures)],
        [1, () => random.pick(handlers).replaceAll("OTHER", "")],
        [isInItsOwnFunction ? (plain ? 5 : 2) : 0, () => ((leavesByThrow = true), random.pick(throwsOut))],
      ])();
      parts.splice(
        random.below(parts.length + 1),
        0,
        fill(
          random.chance(0.5) ? `if (${drawn.includes("at ===") ? "at % 4" : "at"} === K) { ${drawn} }` : drawn,
          target(),
        ),
      );
    }
    const body = parts.join("\n      ");
    const count = random.weighted([
      [1, 0],
      [1, 1],
      [2, 2],
      [4, 3],
      [5, 4],
      [3, 5],
      [1, 9],
      [1, 40],
    ]);
    const atRunTime = (turns: number) => (random.chance(0.6) ? `${turns} + none` : String(turns));
    const turns = isInItsOwnFunction ? "turns" : atRunTime(count);
    const list = `[${Array.from({ length: Math.min(count, 6) }, (_, index) => index).join(", ")}]`;
    const first = targets[0];
    const loop = {
      counted: `for (let at = 0; at < ${turns}; at++) {`,
      countedByVar: `for (var at = 0; at < ${turns}; at++) {`,
      downward: `for (let at = ${turns} - 1; at >= 0; at--) {`,
      tested: `let at = -1;\n    while (++at < ${turns}) {`,
      testedBehind: `let at = 0;\n    do {`,
      testedAtTheEnd: `for (let at = 0; ; ) {`,
      overAList: `for (const at of ${list}) {`,
      overKeys: `for (const key in ${list}) {\n      const at = Number(key);`,
      withoutATest: `for (let at = 0; ; at++) {\n      if (at >= ${turns}) break;`,
      asLongAsTheVariableSays: `for (let at = 0; ${first.kind.size(first.name)} < ${random.pick([3, 9, 30])} && at < 9; at++) {`,
      overAWalker: `for (const at of walker${first.id}) {`,
      insideAnother: `${/ outer;/.test(body) ? "outer: " : ""}for (let out = 0; out < 2; out++)\n    for (let at = 0; at < ${turns}; at++) {`,
      overEntries: `for (const [at, entry] of ${list}.entries()) {\n      sum += entry;`,
      withAClosureInItsHead: `for (let at = 0, first = (): number => at; at < ${turns}; at++) {\n      sum += first();`,
      withAClosureInItsTest: `for (let at = 0; takers.push(() => at), at < ${turns}; at++) {`,
      withAClosureInItsStep: `for (let at = 0; at < ${turns}; takers.push(() => at), at++) {`,
    }[form];
    const end =
      { testedBehind: `} while (++at < ${turns});`, testedAtTheEnd: `  if (++at >= ${turns}) break;\n    }` }[
        form as string
      ] ?? "}";
    let whole = `${loop}\n      ${form === "testedAtTheEnd" ? body.replaceAll("continue;", "break;") : body}\n    ${end}`;
    const shown = targets.map(({ kind, name }) => kind.show(name)).join(", ");
    const isCaughtHere = leavesByThrow && (!isInItsOwnFunction || random.chance(0.5));
    if (isCaughtHere)
      whole = `try {\n    ${whole}\n    } catch (error) {\n      say("caught", (error as Error).name, ${shown});\n    }`;
    else if (!plain && random.chance(0.12))
      whole = `try {\n    ${whole}\n    } finally {\n      say("finally", ${shown});\n    }`;
    const inside = [
      `let seen = "", sum = 0;`,
      // Behind it nobody knows what the variables hold.
      (plain || random.chance(0.5)) && "tell();",
      /\bkept\b/.test(body) && `const kept: (() => void)[] = [];`,
      /\btakers\b/.test(whole) && `const takers: (() => number)[] = [];`,
      whole,
      /\bkept\b/.test(body) && `for (const each of kept.splice(0)) each();`,
      /\btakers\b/.test(whole) && `say("takers", takers.map(take => take()).join());`,
      `say("${label}", seen, sum, ${shown});`,
    ]
      .filter(Boolean)
      .join("\n    ");
    if (!isInItsOwnFunction) {
      suspendsSomewhere ||= place === "hereAndAwaits";
      return { text: `{\n    ${inside}\n  }`, awaits: place === "hereAndAwaits" };
    }
    const again = random.between(0, 5);
    const guarded = (call: string) =>
      leavesByThrow && !isCaughtHere
        ? `try { ${call} } catch (error) { say("thrown", (error as Error).name, ${shown}); }`
        : call;
    const between = fill(random.pick(["", "poke#(1);", "peek#();", "HELD = NEXTONE;"]), target());
    const calls = guarded(
      random.chance(0.4)
        ? `work(${atRunTime(count)}); ${between} work(${atRunTime(again)});`
        : `work(${atRunTime(count)});`,
    );
    const made = {
      below: `const work = (turns: number): void => {\n    ${inside}\n  };\n  ${calls}`,
      declaredBelow: `function work(turns: number): void {\n    ${inside}\n  }\n  ${calls}`,
      twoBelow: `const work = (() => (turns: number): void => {\n    ${inside}\n  })();\n  ${calls}`,
      method: `const worker = { work(turns: number): void {\n    ${inside}\n  } };\n  ${calls.replaceAll("work(", "worker.work(")}`,
      generator: `function* work(turns: number): Generator<string, void, unknown> {\n    ${inside}\n  }\n  ${guarded(
        `for (const step of work(${atRunTime(count)})) { say("step", step); ${between} ${random.pick(["", "", "if (step.length > 8) break;"])} }`,
      )}`,
      async: `const work = async (turns: number): Promise<void> => {\n    ${inside}\n  };\n  ${guarded(
        random.chance(0.5)
          ? `await work(${atRunTime(count)});`
          : `await Promise.all([work(${atRunTime(count)}), work(${again})]);`,
      )}`,
    }[place as "below"];
    suspendsSomewhere ||= place === "async";
    return { text: `{\n  ${made}\n  }`, awaits: place === "async" };
  }

  const ofModule = Array.from({ length: random.between(0, 2) }, () =>
    declared(["let", "let", "let", "var", "export let", "static", "field"], true),
  );
  const scenes: string[] = [];
  for (let scene = 1, count = random.between(1, 2); scene <= count; scene++) {
    const isAtTheTop = random.chance(0.25);
    const mayAwait = random.chance(0.35);
    const ofScene = Array.from({ length: random.between(ofModule.length ? 0 : 1, 2) }, () =>
      declared(isAtTheTop ? ["let", "var", "field"] : ["let", "let", "let", "var", "field", "parameter"]),
    );
    const visible = [...ofModule, ...ofScene].map(each => each.variable);
    let awaits = false;
    const stretches: string[] = [];
    for (let index = 1, loops = random.between(1, 3); index <= loops; index++) {
      const label = `loop ${scene}.${index}`;
      if (random.chance(0.25)) {
        // A variable of one turn of an outer loop, with helpers that are made anew in each turn.
        const { variable, declare, handOut } = declared(["let", "let", "var", "field"]);
        const inner = stretch(label, [variable, ...random.sample(visible, 1)], mayAwait);
        awaits ||= inner.awaits;
        stretches.push(
          `{\n  const left: (() => unknown)[] = [];\n  for (${random.pick(["let", "var"])} around = 0; around < ${random.between(2, 3)}; around++) {\n  ${declare("around")} ${handOut}\n  ${helpersOf(variable, inner.text)}\n  ${inner.text}\n  left.push(() => ${variable.kind.show(variable.name)});\n  }\n  say("left", left.map(each => each()).join());\n  }`,
        );
      } else {
        const made = stretch(label, random.sample(visible, random.between(1, 2)), mayAwait);
        awaits ||= made.awaits;
        stretches.push(made.text);
      }
      if (random.chance(0.6)) stretches.push("tell();");
    }
    const loops = stretches.join("\n  ");
    const again = ofModule
      .filter(() => random.chance(0.5))
      .map(({ variable: { kind, name } }) => `${name} = ${kind.first("seed")};`);
    const inside = [
      ...again,
      "const told = readers.length;",
      ...ofScene.filter(each => each.form !== "parameter").map(each => each.declare("seed")),
      ...ofScene.map(each => each.handOut),
      ...ofScene.map(each => helpersOf(each.variable, loops)),
      loops,
      `say("end ${scene}", ${visible.map(({ kind, name }) => kind.show(name)).join(", ")});`,
      "readers.length = told;",
    ]
      .filter(Boolean)
      .join("\n  ");
    if (isAtTheTop) {
      scenes.push(`{\n  const seed: number = ${random.between(0, 3)};\n  ${inside}\n}`);
      continue;
    }
    const parameters = ofScene.filter(each => each.form === "parameter").map(each => each.variable);
    const call = (seed: string) =>
      `${awaits ? "await " : ""}scene${scene}(${[seed, ...parameters.map(({ kind }) => kind.first(seed))].join(", ")});`;
    scenes.push(
      `${awaits ? "async " : ""}function scene${scene}(${["seed: number", ...parameters.map(({ kind, name }) => `${name}: ${kind.type}`)].join(", ")}): ${awaits ? "Promise<void>" : "void"} {\n  ${inside}\n}\n` +
        random.pick([call("1"), `${call("1")}\n${call("2")}`, `for (let call = 0; call < 3; call++) ${call("call")}`]),
    );
  }
  const all = scenes.join("\n");
  return `const lines: string[] = [];
const none: number = Date.now() < 99 ? 1 : 0;
function say(...parts: unknown[]): void {
  lines.push(parts.join(" "));
}
const readers: (() => unknown)[] = [];
function tell(): void {
  say("told", readers.map(read => read()).join());
}
function fail(really: boolean): void {
  if (really) throw new Error("failed");
}
function orNothing(value: number): number | undefined {
  return value % 3 === 1 ? undefined : value;
}
function eitherKind(value: number): number | string {
  return value % 3 === 1 ? "s" + value : value;
}
${ofModule.map(each => `${each.declare("1")} ${each.handOut}\n${helpersOf(each.variable, all)}`).join("\n")}
${all}
tell();
${suspendsSomewhere ? "await new Promise<void>(resolve => setTimeout(resolve, 1));\n" : ""}console.log(lines.join("\\n"));
`;
}
