// Blocks, loops, `switch` and `try` inside each other, with labels, left in every way, where `finally` may send the program somewhere else.
//
//   nested      labeled blocks, `for`, `while`, `do`, `for .. of` over lists and over iterators that tell of `return`, `for .. in`, `switch` with clauses that fall through, `if`,
//               `try` with `catch`, with `finally`, with both
//   left by     `break` and `continue` with and without labels, `return`, `throw`, the end; out of `try`, out of `catch` and out of `finally`, which then takes the place of whatever was under way
//   functions   ordinary ones, generators that are read to the end, left early and thrown into, async functions that wait inside `try` and `finally`
//   decided     by numbers that each call draws anew, so that one function takes many roads
//   read        every step on the road, what the function answers or throws
import type { Random } from "./random";

export const kinds = ["function", "generator", "async function"] as const;
export type Kind = (typeof kinds)[number];

const head = `const lines = [];
function note(...parts) {
  lines.push(parts.join(" "));
}
let state = 1;
let fuel = 0;
function hit(place) {
  if (fuel-- < 0) throw new RangeError("out of fuel");
  state = (Math.imul(state, 1103515245) + 12345 + place) >>> 0;
  return (state >>> 16) % 3 === 0;
}
function draw(place) {
  hit(place);
  return (state >>> 16) % 4;
}
function steps(name, count) {
  let at = 0;
  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      note("next of", name);
      return at < count ? { value: at++, done: false } : { value: undefined, done: true };
    },
    return() {
      note("return of", name);
      return {};
    },
  };
}
function failure(error) {
  return error instanceof Error ? error.constructor.name + " " + error.message : String(error);
}
`;

type Scope = { labels: string[]; loops: string[]; inLoop: boolean; inBreakable: boolean };

export function generate(random: Random, kind: Kind): string {
  let places = 0;
  const pause = () =>
    kind === "generator"
      ? `yield ${places++};`
      : kind === "async function"
        ? `await null;`
        : `note("step ${places++}");`;

  const leave = (scope: Scope): string =>
    random.weighted([
      [scope.labels.length ? 5 : 0, () => `break ${random.pick(scope.labels)};`],
      [scope.loops.length ? 4 : 0, () => `continue ${random.pick(scope.loops)};`],
      [scope.inBreakable ? 2 : 0, () => `break;`],
      [scope.inLoop ? 2 : 0, () => `continue;`],
      [2, () => `return "returned at ${places++}";`],
      [2, () => `throw new Error("thrown at ${places++}");`],
    ])();

  const block = (depth: number, scope: Scope): string =>
    Array.from({ length: random.between(1, 3) }, () => statement(depth, scope)).join("\n");

  const statement = (depth: number, scope: Scope): string => {
    const place = places++;
    if (depth <= 0)
      return random.weighted([
        [3, () => `note("at ${place}");`],
        [4, () => `if (hit(${place})) ${leave(scope)}`],
        [1, () => pause()],
      ])();
    const label = `l${place}`;
    const labeled = random.chance(0.6);
    const inLoop = (): Scope => ({
      labels: labeled ? [...scope.labels, label] : scope.labels,
      loops: labeled ? [...scope.loops, label] : scope.loops,
      inLoop: true,
      inBreakable: true,
    });
    const prefix = labeled ? `${label}: ` : "";
    return random.weighted<() => string>([
      [2, () => `note("at ${place}");`],
      [4, () => `if (hit(${place})) ${leave(scope)}`],
      [1, () => pause()],
      [
        3,
        () =>
          `${label}: {\nnote("in ${label}");\n${block(depth - 1, { ...scope, labels: [...scope.labels, label] })}\nnote("the end of ${label}");\n}`,
      ],
      [
        2,
        () =>
          `${prefix}for (let turn${place} = 0; turn${place} < 3; turn${place}++) {\nnote("turn", turn${place}, "of ${place}");\n${block(depth - 1, inLoop())}\n}`,
      ],
      [
        1,
        () =>
          `let count${place} = 0;\n${prefix}while (count${place}++ < 3) {\nnote("turn", count${place}, "of ${place}");\n${block(depth - 1, inLoop())}\n}`,
      ],
      [
        1,
        () =>
          `let count${place} = 0;\n${prefix}do {\nnote("turn", count${place}, "of ${place}");\n${block(depth - 1, inLoop())}\n} while (++count${place} < 3);`,
      ],
      [
        2,
        () =>
          `${prefix}for (const each${place} of steps("${place}", 3)) {\nnote("turn", each${place}, "of ${place}");\n${block(depth - 1, inLoop())}\n}`,
      ],
      [
        1,
        () =>
          `${prefix}for (const each${place} of [1, 2, 3]) {\nnote("turn", each${place}, "of ${place}");\n${block(depth - 1, inLoop())}\n}`,
      ],
      [
        1,
        () =>
          `${prefix}for (const key${place} in { a: 1, b: 2, c: 3 }) {\nnote("turn", key${place}, "of ${place}");\n${block(depth - 1, inLoop())}\n}`,
      ],
      [
        2,
        () => {
          const inner: Scope = {
            ...scope,
            labels: labeled ? [...scope.labels, label] : scope.labels,
            inBreakable: true,
          };
          return `${prefix}switch (draw(${place})) {\ncase 0:\nnote("clause 0 of ${place}");\n${block(depth - 1, inner)}\ncase 1:\nnote("clause 1 of ${place}");\n${block(depth - 1, inner)}\n${random.pick(["break;", ""])}\ndefault:\nnote("the last clause of ${place}");\n${block(depth - 1, inner)}\ncase 2:\nnote("clause 2 of ${place}");\n}`;
        },
      ],
      [1, () => `if (hit(${place})) {\n${block(depth - 1, scope)}\n} else {\n${block(depth - 1, scope)}\n}`],
      [
        7,
        () => {
          const form = random.pick(["catch", "finally", "both", "both", "finally"]);
          return (
            `try {\nnote("try ${place}");\n${block(depth - 1, scope)}\n}` +
            (form !== "finally"
              ? ` catch (error) {\nnote("catch ${place}", failure(error));\n${block(depth - 1, scope)}\n}`
              : "") +
            (form !== "catch" ? ` finally {\nnote("finally ${place}");\n${block(depth - 1, scope)}\n}` : "")
          );
        },
      ],
    ])();
  };

  const rows: string[] = [];
  for (let id = 0, count = random.between(2, 4); id < count; id++) {
    const body = block(random.between(2, 4), { labels: [], loops: [], inLoop: false, inBreakable: false });
    const opening =
      kind === "generator"
        ? `function* road${id}()`
        : kind === "async function"
          ? `async function road${id}()`
          : `function road${id}()`;
    rows.push(`${opening} {\n${body}\nreturn "the end";\n}`);
    const call =
      kind === "function"
        ? `note("answers", road${id}());`
        : kind === "async function"
          ? `note("answers", await road${id}());`
          : `const walk = road${id}();\nlet step = walk.next();\nlet taken = 0;\nwhile (!step.done) {\nnote("yielded", step.value);\ntaken++;\nstep = seed % 4 === 1 && taken === 2 ? walk.return("handed in") : seed % 4 === 2 && taken === 3 ? walk.throw(new Error("thrown in")) : walk.next();\n}\nnote("answers", step.value);`;
    rows.push(
      `for (let seed = 1; seed <= 12; seed++) {\nstate = seed * 7919 + ${id};\nfuel = 400;\nnote("road ${id}, seed", seed);\ntry {\n${call}\n} catch (error) {\nnote("THROWS", failure(error));\n}\n}`,
    );
  }
  return `${head}${rows.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}
