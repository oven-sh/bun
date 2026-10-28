// Where two ways through a function meet, a test that follows may already be decided for one of them, two ways that do the same may become one, and a test may say what a later test will say.
// Whatever stood on the way that is skipped or joined still happens, once, and a value that both ways hand on is the one of the way that was taken.
// How the ways part x what stands on them x how they are told apart again behind the place where they meet, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `function note(label: string, value: number): number { say(label); return value; }
const talker = { valueOf(): number { say("valueOf"); return 1; } };
const box: { value: number; flag?: boolean } = { value: 0 };
function isOdd(value: number): boolean { return value % 2 === 1; }
function idle(): void {}
`;

/** Sets `flag`, of type `F`, on two or more ways. `X` stands on one way, `Y` on the other. */
const partings: Record<string, { type: string; text: string }> = {
  ifElse: { type: "boolean", text: `if (now % 2) { X flag = true; } else { Y flag = false; }` },
  ifAlone: { type: "boolean", text: `flag = false; if (now % 2) { X flag = true; }` },
  conditional: { type: "boolean", text: `flag = now % 2 ? (X_, true) : (Y_, false);` },
  and: { type: "boolean", text: `flag = now % 2 === 1 && (X_, now > 0);` },
  or: { type: "boolean", text: `flag = now % 2 === 1 || (Y_, now > 100);` },
  threeWays: { type: "number", text: `if (now % 3 === 0) { X flag = 0; } else if (now % 3 === 1) { Y flag = 1; } else { X Y flag = 2; }` },
  cases: { type: "number", text: `switch (now % 3) { case 0: X flag = 0; break; case 1: Y flag = 1; break; default: flag = 2; }` },
  casesThatFallThrough: { type: "number", text: `flag = 9; switch (now % 3) { case 0: X flag = 0; case 1: Y flag += 1; break; default: flag = 2; }` },
  sameOnBothWays: { type: "number", text: `if (now % 2) { X flag = 7; } else { X flag = 7; }` },
  sameValueOtherWork: { type: "number", text: `if (now % 2) { X flag = 7; } else { Y flag = 7; }` },
  nullOrObject: { type: "{ at: number } | null", text: `if (now % 2) { X flag = { at: now }; } else { Y flag = null; }` },
  undefinedOrNumber: { type: "number | undefined", text: `if (now % 2) { X flag = now; } else { Y flag = undefined; }` },
  textOrNumber: { type: "string | number", text: `if (now % 2) { X flag = "t" + now; } else { Y flag = now; }` },
  zeroOrMinusZero: { type: "number", text: `if (now % 2) { X flag = 0; } else { Y flag = -0; }` },
  byAHandler: { type: "boolean", text: `try { fail(now % 2 === 1); Y flag = false; } catch { X flag = true; }` },
  byALabel: { type: "boolean", text: `flag = false; out: { if (now % 2) break out; Y flag = true; }` },
  byALoopLeftEarly: { type: "number", text: `flag = -1; for (let at = 0; at < 3; at++) { if (at === now % 4) { X flag = at; break; } Y }` },
  byACallThatTests: { type: "boolean", text: `flag = isOdd(now); if (flag) { X } else { Y }` },
};

const work: Record<string, [statement: string, expression: string]> = {
  nothing: [``, `idle()`],
  says: [`say("x");`, `say("x")`],
  counts: [`count++;`, `count++`],
  writesAField: [`box.value++;`, `box.value++`],
  asksAnObject: [`+talker;`, `+talker`],
  writesAVariableReadLater: [`carried += 3;`, `(carried += 3)`],
};

const meetings: Record<string, string> = {
  testedAgain: `if (flag) say("yes"); else say("no");`,
  testedTwice: `if (flag) say("yes"); say("between"); if (flag) say("yes again"); else say("no again");`,
  testedTheOtherWayRound: `if (!flag) say("not"); else say("is");`,
  compared: `say(flag === (true as unknown), flag === (1 as unknown), flag === (7 as unknown), flag == null);`,
  switchedOn: `switch (flag) { case true as never: say("true"); break; case 0 as never: say("zero"); break; case 1 as never: say("one"); break; case null as never: say("null"); break; default: say("else"); }`,
  askedForItsKind: `say(typeof flag);`,
  askedForItsKindAndUsed: `if (typeof flag === "number") say((flag as unknown as number) + 1); else if (typeof flag === "string") say((flag as unknown as string).length); else say(String(flag));`,
  handedOn: `say(String(flag), Object.is(flag, -0));`,
  chosenBy: `say(flag ? carried : count);`,
  testedInALoop: `for (let at = 0; at < 2; at++) { if (flag) say("yes", at); else say("no", at); }`,
  testedBehindAWrite: `box.flag = !!flag; count++; if (box.flag) say("yes"); else say("no");`,
  testedWithAnother: `if (flag && now > 1) say("both"); else if (flag || now > 2) say("one"); else say("none");`,
  answered: `say((() => { if (flag) return "yes"; return "no"; })());`,
  optionalRead: `say((flag as unknown as { at?: number } | null | undefined)?.at);`,
  defaulted: `say(String(flag ?? "none"), String(flag || "empty"));`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 600;

const fewPlaces = ["once", "often", "loop", "loopWithContinue", "loopWithBreak", "handlerInALoop", "cleanup", "copiedIntoALoop", "inAClosure", "loopWithAYield", "loopWithAnAwait", "moduleLoop"];

export function programs(isTyped?: boolean) {
  const everywhere: Stretch[] = [], inFewPlaces: Stretch[] = [];
  const names = Object.keys(work);
  let nth = 0;
  for (const parting in partings)
    for (const first of names)
      for (const second of names) {
        if (first !== "nothing" && second !== "nothing" && first !== second && (names.indexOf(first) + names.indexOf(second)) % 2) continue;
        for (const meeting in meetings)
          (nth++ % 12 ? inFewPlaces : everywhere).push({
            name: `${parting}-${first}-${second}-${meeting}`,
            beside,
            before: seed => `let count = ${seed}, carried = 0;`,
            body: () => `let flag!: ${partings[parting].type}; ${partings[parting].text.replaceAll("X_", work[first][1]).replaceAll("Y_", work[second][1]).replaceAll("X", work[first][0]).replaceAll("Y", work[second][0])} ${meetings[meeting]}`,
            after: `count + ":" + carried + ":" + box.value`,
          });
      }
  return alsoWithTypesErased([...inEveryPlace(everywhere.map(named), isTyped), ...inEveryPlace(inFewPlaces.map(named), isTyped, fewPlaces)], isTyped);
}
