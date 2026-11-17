// Places a block of code in different contexts. A compiler rewrite is written with straight-line code in mind; the same
// block also appears in a loop, in two loops, beside a `continue` or `break`, under an exception handler that reads its
// partial results, and so on.
export type Stretch = {
  name: string;
  /** Top-level declarations. */
  beside?: string;
  /** Statements before the block, in the same function. `seed` is an expression for a small integer. */
  before: (seed: string) => string;
  /** The block. `turn` is an expression for a small integer. What it observes goes to `say`. */
  body: (turn: string) => string;
  /** An expression for the block's result. */
  after: string;
  /** The block contains its own `await` or `yield`, so it can only go in a function that allows it. */
  suspends?: "await" | "yield";
  /** The block contains its own `return`, so it can only go in a function. */
  returns?: true;
};

/** How loops are written: `upTo` for a trip count, `listOf` for an iterated array. */
export type Loops = { upTo: (turns: number) => string; listOf: (list: string) => string };
type Placed = Stretch & Loops;

/**
 * A short loop with a constant trip count may be fully unrolled. Half of the names make the count known only at run
 * time.
 */
export function loopsOf(name: string): Loops {
  const isWrittenDown = Bun.hash(name + " turns") % 2n === 0n;
  return {
    upTo: turns => (isWrittenDown ? `${turns}` : `${turns} + extraTurns`),
    listOf: list => (isWrittenDown ? list : `${list}.slice(extraTurns)`),
  };
}

/**
 * Existing source text, with its counted loops of under ten iterations rewritten as loopsOf(name) writes them. The
 * program declares `extraTurns`.
 */
export const withLoopsOf = (name: string, text: string) =>
  text.replace(/(for \(let \w+ = 0; \w+ < )(\d)(?=;)/g, (_, start, turns) => start + loopsOf(name).upTo(Number(turns)));

/** An existing whole program, with the declaration added at its top if one of its loops needs it. */
export function programWithLoopsOf(name: string, text: string) {
  const written = withLoopsOf(name, text);
  return written === text ? text : `const extraTurns = process.argv.length > 99 ? 1 : 0;\n${written}`;
}

type Place = { kind?: "await" | "yield"; isOutsideFunctions?: true; text: (stretch: Placed) => string };

const head = `const said: unknown[] = [];
function say(...seen: unknown[]): void { for (let at = 0; at < seen.length; at++) said.push(seen[at]); }
function tell(label: string): void { let text = ""; for (let at = 0; at < said.length; at++) text += (at ? "," : "") + String(said[at]); said.length = 0; console.log(label, text); }
function fail(when: boolean): void { if (when) throw new RangeError("stop"); }
function attempt(label: string, run: () => void): void { try { run(); } catch (error) { say("threw", (error as Error).name); } tell(label); }
async function attemptLater(label: string, run: () => Promise<void>): Promise<void> { try { await run(); } catch (error) { say("threw", (error as Error).name); } tell(label); }
`;

// 0 in every run, which no build can know.
const turnsNobodyKnows = `const extraTurns: number = process.argv.length > 99 ? 1 : 0;\n`;

const twice = `attempt("one", () => run(1)); attempt("two", () => run(2));`;
const often = `{ const all = new Set<string>(); for (let round = 0; round < 300; round++) { try { run(round % 3); } catch (error) { say("threw"); } all.add(said.join()); said.length = 0; } console.log("often", [...all].join(" | ")); }`;
const plain = (body: (s: Placed) => string, calls = twice): Place => ({ text: s => `function run(seed: number): void { ${body(s)} }\n${calls}` });
const steps = `function drive(label: string, seed: number): void { attempt(label, () => { const all = run(seed); for (let step = all.next(); !step.done; step = all.next()) say("step", step.value); }); }\ndrive("one", 1); drive("two", 2);`;
const stepsOfTwo = `attempt("two at a time", () => { const first = run(1), second = run(2); for (let at = 0; at < 8; at++) { say("first", first.next().value); say("second", second.next().value); } });`;
const waits = `await attemptLater("one", () => run(1)); await attemptLater("two at a time", async () => { await Promise.all([run(1), run(2)]); });`;

export const places: Record<string, Place> = {
  once: plain(s => `${s.before("seed")} { ${s.body("seed")} } say(${s.after});`),
  often: plain(s => `${s.before("seed")} { ${s.body("seed")} } say(${s.after});`, often),
  twiceInARow: plain(s => `${s.before("seed")} { ${s.body("seed")} } { ${s.body("seed + 1")} } say(${s.after});`),
  module: { isOutsideFunctions: true, text: s => `try { ${s.before("1")} { ${s.body("1")} } say(${s.after}); } catch (error) { say("threw", (error as Error).name); }\ntell("module");` },
  moduleLoop: { isOutsideFunctions: true, text: s => `try { ${s.before("1")} for (let turn = 0; turn < ${s.upTo(4)}; turn++) { ${s.body("turn")} } say(${s.after}); } catch (error) { say("threw", (error as Error).name); }\ntell("module");` },
  loop: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(4)}; turn++) { ${s.body("turn")} } say(${s.after});`),
  loopThatStartsAnew: plain(s => `for (let turn = 0; turn < ${s.upTo(3)}; turn++) { ${s.before("seed + turn")} { ${s.body("turn")} } say(${s.after}); }`),
  loopOften: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(3)}; turn++) { ${s.body("turn")} } say(${s.after});`, often),
  whileLoop: plain(s => `${s.before("seed")} let turn = 0; while (turn < seed + 2) { ${s.body("turn")} turn++; } say(${s.after});`),
  doLoop: plain(s => `${s.before("seed")} let turn = 0; do { ${s.body("turn")} } while (++turn < ${s.upTo(3)}); say(${s.after});`),
  loopOverAList: plain(s => `${s.before("seed")} for (const turn of ${s.listOf("[3, 1, seed]")}) { ${s.body("turn")} } say(${s.after});`),
  twoLoops: plain(s => `${s.before("seed")} for (let outer = 0; outer < ${s.upTo(3)}; outer++) for (let inner = 0; inner < ${s.upTo(2)}; inner++) { ${s.body("outer * 2 + inner")} } say(${s.after});`),
  twoLoopsStartedBetween: plain(s => `for (let outer = 0; outer < ${s.upTo(2)}; outer++) { ${s.before("seed + outer")} for (let inner = 0; inner < ${s.upTo(3)}; inner++) { ${s.body("inner")} } say(${s.after}); }`),
  loopWithContinue: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(5)}; turn++) { { ${s.body("turn")} } if (turn % 2) continue; { ${s.body("turn + 10")} } } say(${s.after});`),
  loopWithBreak: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(5)}; turn++) { { ${s.body("turn")} } if (turn === seed) break; { ${s.body("turn + 10")} } } say(${s.after});`),
  loopsWithLabels: plain(s => `${s.before("seed")} outer: for (let first = 0; first < ${s.upTo(3)}; first++) { for (let second = 0; second < ${s.upTo(3)}; second++) { { ${s.body("first * 3 + second")} } if (second === first) continue outer; if (first + second === 3) break outer; } say("between", ${s.after}); } say(${s.after});`),
  loopWithReturn: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(5)}; turn++) { { ${s.body("turn")} } if (turn === seed) { say("leaves", ${s.after}); return; } } say(${s.after});`),
  branches: plain(s => `${s.before("seed")} if (seed % 2) { ${s.body("1")} } else { ${s.body("2")} } { ${s.body("3")} } say(${s.after});`),
  cases: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(4)}; turn++) switch (turn) { case 0: { ${s.body("turn")} } case 1: { ${s.body("turn + 10")} } break; case 2: say("two"); break; default: { ${s.body("turn + 20")} } } say(${s.after});`),
  handler: plain(s => `${s.before("seed")} try { { ${s.body("1")} } fail(seed === 1); { ${s.body("2")} } } catch (error) { say("caught", ${s.after}); } say(${s.after});`),
  cleanup: plain(s => `${s.before("seed")} try { { ${s.body("1")} } if (seed === 1) return; { ${s.body("2")} } } finally { say("finally", ${s.after}); }`),
  handlerAndCleanup: plain(s => `${s.before("seed")} try { try { { ${s.body("1")} } fail(seed === 1); { ${s.body("2")} } } finally { say("finally", ${s.after}); } } catch (error) { say("caught", ${s.after}); { ${s.body("3")} } } say(${s.after});`),
  handlerInALoop: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(4)}; turn++) { try { { ${s.body("turn")} } fail(turn === seed); { ${s.body("turn + 10")} } } catch (error) { say("caught", ${s.after}); } finally { say("finally", ${s.after}); } } say(${s.after});`),
  loopUnderAHandler: plain(s => `${s.before("seed")} try { for (let turn = 0; turn < ${s.upTo(4)}; turn++) { { ${s.body("turn")} } fail(turn === seed + 1); } } catch (error) { say("caught", ${s.after}); } say(${s.after});`),
  inTheHandler: plain(s => `${s.before("seed")} for (let turn = 0; turn < ${s.upTo(3)}; turn++) { try { fail(turn !== 1); say("quiet"); } catch (error) { ${s.body("turn")} } } say(${s.after});`),
  copiedIntoItsCaller: { text: s => `function inner(seed: number) { ${s.before("seed")} { ${s.body("seed")} } return ${s.after}; }\nfunction run(seed: number): void { say(inner(seed)); say(inner(seed + 1)); }\n${twice}` },
  copiedIntoALoop: { text: s => `function inner(seed: number) { ${s.before("seed")} { ${s.body("seed")} } return ${s.after}; }\nfunction run(seed: number): void { for (let turn = 0; turn < ${s.upTo(3)}; turn++) say(inner(seed + turn)); }\n${twice}\n${often}` },
  alsoCalledWhereItSeldomRuns: { text: s => `function inner(seed: number) { ${s.before("seed")} { ${s.body("seed")} } return ${s.after}; }\nfunction run(seed: number): void { for (let turn = 0; turn < ${s.upTo(3)}; turn++) say(inner(turn)); }\nfunction seldom(seed: number): void { try { fail(seed > 0); } catch (error) { say("seldom", inner(seed + 5)); } }\n${often}\nattempt("seldom", () => seldom(1)); attempt("one", () => run(1));` },
  heldByAClosure: plain(s => `${s.before("seed")} const later = () => ${s.after}; { ${s.body("1")} } say("later", later()); { ${s.body("2")} } say("later", later());`),
  inAClosure: plain(s => `${s.before("seed")} const step = (turn: number): void => { ${s.body("turn")} }; step(1); step(2); [3, 4].forEach(turn => step(turn)); say(${s.after});`),
  inAClosureThatOutlivesItsMaker: { text: s => `function make(seed: number) { ${s.before("seed")} return { step: (turn: number): void => { ${s.body("turn")} }, left: () => ${s.after} }; }\nfunction run(seed: number): void { const first = make(seed), second = make(seed + 1); for (let turn = 0; turn < ${s.upTo(3)}; turn++) { first.step(turn); second.step(turn + 1); } say(first.left(), second.left()); }\n${twice}` },
  method: { text: s => `class Holder { seed: number; constructor(seed: number) { this.seed = seed; } run(): void { const seed = this.seed; ${s.before("seed")} for (let turn = 0; turn < ${s.upTo(3)}; turn++) { ${s.body("turn")} } say(${s.after}); } }\nattempt("one", () => new Holder(1).run()); attempt("two", () => new Holder(2).run());` },
  constructor: { text: s => `class Holder { left: unknown; constructor(seed: number) { ${s.before("seed")} { ${s.body("seed")} } this.left = ${s.after}; } }\nattempt("one", () => say(new Holder(1).left)); attempt("two", () => say(new Holder(2).left));` },
  callsItself: { text: s => `function run(seed: number, depth = 0): void { ${s.before("seed + depth")} { ${s.body("depth")} } if (depth < 2) run(seed, depth + 1); { ${s.body("depth + 10")} } say(${s.after}); }\n${twice}` },
  aroundAYield: { kind: "yield", text: s => `function* run(seed: number): Generator<unknown, void> { ${s.before("seed")} { ${s.body("1")} } yield ${s.after}; { ${s.body("2")} } yield ${s.after}; }\n${steps}\n${stepsOfTwo}` },
  loopWithAYield: { kind: "yield", text: s => `function* run(seed: number): Generator<unknown, void> { ${s.before("seed")} for (let turn = 0; turn < ${s.upTo(3)}; turn++) { { ${s.body("turn")} } yield ${s.after}; } }\n${steps}\n${stepsOfTwo}` },
  yieldUnderACleanup: { kind: "yield", text: s => `function* run(seed: number): Generator<unknown, void> { ${s.before("seed")} try { { ${s.body("1")} } yield ${s.after}; { ${s.body("2")} } yield 0; } finally { say("finally", ${s.after}); } }\nattempt("left early", () => { for (const step of run(1)) { say("step", step); break; } });\n${steps}` },
  aroundAnAwait: { kind: "await", text: s => `async function run(seed: number): Promise<void> { ${s.before("seed")} { ${s.body("1")} } await null; { ${s.body("2")} } say(${s.after}); }\n${waits}` },
  loopWithAnAwait: { kind: "await", text: s => `async function run(seed: number): Promise<void> { ${s.before("seed")} for (let turn = 0; turn < ${s.upTo(3)}; turn++) { { ${s.body("turn")} } await null; } say(${s.after}); }\n${waits}` },
  awaitUnderAHandler: { kind: "await", text: s => `async function run(seed: number): Promise<void> { ${s.before("seed")} try { { ${s.body("1")} } await Promise.reject(new RangeError("stop")); { ${s.body("2")} } } catch (error) { say("caught", ${s.after}); } say(${s.after}); }\n${waits}` },
};

export type Written = { name: string; file: string; text: string; flags?: string[] };

/** Every block in every context that allows it. Without types the same text is JavaScript. */
export function inEveryPlace(stretches: Stretch[], isTyped: boolean | undefined, only?: string[]): Written[] {
  const made: Written[] = [];
  for (const stretch of stretches)
    for (const [placeName, place] of Object.entries(places)) {
      if (only && !only.includes(placeName)) continue;
      if (stretch.suspends && stretch.suspends !== place.kind) continue;
      if (stretch.returns && place.isOutsideFunctions) continue;
      const name = `${stretch.name}-${placeName}`;
      const placed: Placed = { ...stretch, ...loopsOf(name) };
      const text = () => {
        const written = withLoopsOf(name, `${stretch.beside ?? ""}\n${place.text(placed)}`);
        return `${head}${written.includes("extraTurns") ? turnsNobodyKnows : ""}${written}\nexport {};\n`;
      };
      made.push({
        name,
        file: isTyped ? "program.ts" : "program.mjs",
        get text() {
          return isTyped ? text() : new Bun.Transpiler({ loader: "ts" }).transformSync(text());
        },
      });
      // One typed program in four is also built with types erased.
      if (isTyped && Bun.hash(name) % 4n === 0n) made.push({ name: `${name}-erased`, file: "program.ts", flags: ["--aot-erase-types"], get text() { return text(); } });
    }
  return made;
}
