// A variable that a closure holds lives as long as the closure, and there is one of it for each time its scope was entered: for each call, each turn of a loop, each level of a function that
// calls itself. Where the scope is entered once the variable may live in a fixed place; where it never changes the closure may hold its value.
// What kind of variable x who writes it and when x who reads it, each in every place. What one run of the stretch made is read again after the next run.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `type Pair = { read: () => unknown; write: (value: number) => void };
const older: Pair[] = [];
const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
function keep(pair: Pair): Pair { older.push(pair); if (older.length > 3) older.shift(); return pair; }
function tellOlder(): string { let text = ""; for (const each of older) text += String(each.read()) + ";"; return text; }
`;

/** Statements that declare `pair`, whose closures hold the variable. `V` is its first value. `W` stands where the scope itself may write it. */
const variables: Record<string, string> = {
  let: `let held = V; const pair: Pair = { read: () => held, write: value => { held = value; } }; W`,
  const: `const held = V; const pair: Pair = { read: () => held, write: () => {} };`,
  var: `var held = V; const pair: Pair = { read: () => held, write: value => { held = value; } }; W`,
  declaredBehindTheClosures: `const pair: Pair = { read: () => held, write: value => { held = value; } }; let held = V; W`,
  withoutAFirstValue: `let held: number | undefined; const pair: Pair = { read: () => held, write: value => { held = value; } }; if (V % 2) held = V; W`,
  parameter: `const pair = ((held: number): Pair => ({ read: () => held, write: value => { held = value; } }))(V);`,
  parameterWithADefault: `const pair = ((given?: number, held = V): Pair => ({ read: () => held + (given ?? 0), write: value => { held = value; } }))();`,
  restParameter: `const pair = ((...held: number[]): Pair => ({ read: () => held.join("+"), write: value => { held = [value]; } }))(V, 1);`,
  caughtError: `let pair!: Pair; try { throw V; } catch (held) { pair = { read: () => held, write: value => { held = value; } }; }`,
  counterOfALoop: `let pair!: Pair; for (let held = V; held < V + 2; held++) { if (held === V) pair = { read: () => held, write: value => { held = value; } }; }`,
  memberOfAWalk: `let pair!: Pair; for (let held of [V, V + 1]) { pair ??= { read: () => held, write: value => { held = value; } }; held += 100; }`,
  twoDeep: `let held = V; const pair: Pair = { read: () => (() => held)(), write: value => { (() => { held = value; })(); } }; W`,
  heldByAFunctionDeclaration: `let held = V; function reads() { return held; } function writes(value: number) { held = value; } const pair: Pair = { read: reads, write: writes }; W`,
  heldByAMethod: `let held = V; const pair: Pair = { read() { return held; }, write(value) { held = value; } }; W`,
  heldByAClass: `let held = V; class Holds { read = () => held; write = (value: number) => { held = value; }; } const pair: Pair = new Holds(); W`,
  heldByAGenerator: `let held = V; const steps = (function* () { for (;;) yield held; })(); const pair: Pair = { read: () => steps.next().value, write: value => { held = value; } }; W`,
  thisOfTheScope: `const pair: Pair = (function (this: { held: number }): Pair { return { read: () => this.held, write: value => { this.held = value; } }; }).call({ held: V });`,
  argumentsOfTheScope: `const pair: Pair = (function (held: number): Pair { return { read: () => arguments[0] + ":" + held, write: value => { held = value; } }; })(V);`,
  anObject: `const held = { value: V }; const pair: Pair = { read: () => held.value, write: value => { held.value = value; } };`,
  aList: `const held = [V]; const pair: Pair = { read: () => held.join("+"), write: value => { held.push(value); } };`,
  aText: `let held = "t" + V; const pair: Pair = { read: () => held, write: value => { held += value; } };`,
  twoVariables: `let held = V, beside = V + 1; const pair: Pair = { read: () => held + ":" + beside, write: value => { beside = held; held = value; } }; W`,
  oneOfTwoIsNeverWritten: `let held = V; const fixed = V + 1; const pair: Pair = { read: () => held + ":" + fixed, write: value => { held = value + fixed; } }; W`,
  aClosure: `let held = () => V; const pair: Pair = { read: () => held(), write: value => { held = () => value; } };`,
};

const scopeWrites: Record<string, string> = {
  never: ``,
  once: `held = 70;`,
  addsToIt: `held! += 70;`,
  onOneWay: `if (pair.read() === 1) held = 71;`,
  inALoop: `for (let at = 0; at < 2; at++) held!++;`,
};

const uses: Record<string, (turn: string) => string> = {
  isRead: () => `say(pair.read());`,
  isWrittenAndRead: turn => `pair.write(${turn} + 20); say(pair.read());`,
  isReadWrittenAndRead: turn => `say(pair.read()); pair.write(${turn} + 20); say(pair.read());`,
  isKept: () => `keep(pair); say(tellOlder());`,
  isKeptAndWritten: turn => `keep(pair).write(${turn} + 30); say(tellOlder());`,
  theOlderOnesAreWritten: turn => `keep(pair); older[0].write(${turn} + 40); say(tellOlder());`,
  goesThroughUnknownCode: turn => `unknown(pair).write(${turn} + 50); say(pair.read());`,
  isReadInALoop: turn => `for (let at = 0; at < 2; at++) { say(pair.read()); pair.write(${turn} + at); }`,
  isReadInAHandler: turn => `try { pair.write(${turn} + 60); fail(true); } catch { say(pair.read()); }`,
  isReadByACallback: () => `say([1, 2].map(() => pair.read()).join("/"));`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 250;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const variable in variables)
    for (const scopeWrite in scopeWrites) {
      if (scopeWrite !== "never" && !variables[variable].includes("W")) continue;
      if (variable === "twoVariables" && scopeWrite === "onOneWay") continue;
      for (const use in uses)
        all.push({
          name: `${variable}-${scopeWrite}-${use}`,
          beside,
          before: seed => `let base = ${seed};`,
          body: turn => `${variables[variable].replaceAll("V", `(base + ${turn})`).replace("W", () => scopeWrites[scopeWrite])} ${uses[use](turn)}`,
          after: "tellOlder() + base",
        });
    }
  return alsoWithTypesErased(inEveryPlace(all.map(named), isTyped), isTyped);
}
