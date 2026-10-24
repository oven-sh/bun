// A loop that runs often and has a way through it that is seldom taken may be kept in two copies: one that knows what the usual turns leave behind, and one for the turns behind the rare way.
// What goes round the loop is the same in both, a turn runs in one of them, and the loop may come back to the first copy only when everything is again as that copy takes it to be.
// What goes round the loop x what the rare way does to it x when the rare way is taken, each in every place.
import { alsoWithTypesErased } from "./also-with-types-erased";
import { inEveryPlace, type Stretch } from "./where-a-stretch-stands";

const beside = `const table: Record<string, (given: unknown) => unknown> = { same: given => given };
function unknown<T>(given: T): T { return table["sa" + "me"](given) as T; }
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
class Other { y = 1; x = 2; extra = 3; }
`;

/** `declares` what goes round, `usual` is the work of every turn, `left` tells what is left. The rare ways name `carried`. */
type Carried = { declares: string; usual: string; left: string; rare: Record<string, string> };
const carried: Record<string, Carried> = {
  wholeNumber: {
    declares: `let carried: number | string | undefined = start;`,
    usual: `carried = (carried as number) + 1;`,
    left: `String(carried)`,
    rare: { becomesAFraction: `carried = (carried as number) + 0.5;`, becomesAText: `carried = "t" + carried;`, becomesVeryLarge: `carried = 2147483647;`, becomesUndefined: `carried = undefined;`, becomesMinusZero: `carried = -0;`, becomesWholeAgain: `carried = 0.5; carried = 3;` },
  },
  object: {
    declares: `let carried: { x: number; y: number } = new Point(start, 1);`,
    usual: `carried.x += carried.y;`,
    left: `carried.x + ":" + carried.y + ":" + Object.keys(carried).join("")`,
    rare: {
      isReplacedByAnotherKind: `carried = new Other();`,
      isReplacedByALiteral: `carried = { y: 2, x: carried.x };`,
      isReplacedByTheSameKind: `carried = new Point(carried.x, 2);`,
      getsAnotherName: `(carried as any).more = 1;`,
      losesAName: `delete (carried as any).y; carried.y = 3;`,
      getsAnAccessor: `Object.defineProperty(carried, "y", { get() { return 2; }, configurable: true });`,
      isFrozen: `carried = Object.freeze(new Point(carried.x, 1)); try { carried.x++; } catch { carried = new Point(-1, 1); }`,
      holdsAFraction: `carried.y = 0.5;`,
      holdsAText: `(carried as any).y = "s";`,
      goesThroughUnknownCode: `unknown(carried).y++;`,
    },
  },
  list: {
    declares: `let carried: unknown[] = [start, 1, 2];`,
    usual: `carried[at % 3] = (carried[at % 3] as number) + 1;`,
    left: `carried.join() + ":" + carried.length`,
    rare: {
      holdsAFraction: `carried[1] = 0.5;`,
      holdsAText: `carried[1] = "s";`,
      getsAHole: `delete carried[1]; carried[1] = 0;`,
      grows: `carried.push(9);`,
      shrinks: `carried.length = 2; carried[2] = 0;`,
      isReplaced: `carried = [0.5, 1, 2];`,
      growsFarOut: `carried[40] = 1; carried.length = 3;`,
      isFrozen: `carried = Object.freeze([1, 2, 3]) as unknown[]; try { carried[0] = 2; } catch { carried = [7, 7, 7]; }`,
    },
  },
  variableOfAClosure: {
    declares: `let carried = start; const read = () => carried; const write = (value: number) => { carried = value; };`,
    usual: `carried += 1;`,
    left: `String(read())`,
    rare: { isWrittenByTheClosure: `write(read() * 2);`, isWrittenWithAFraction: `write(0.5);`, theClosureGoesThroughUnknownCode: `unknown(write)(100);` },
  },
  text: {
    declares: `let carried = "s" + start;`,
    usual: `carried += at % 10;`,
    left: `carried.length + carried.slice(-6)`,
    rare: { isCut: `carried = carried.slice(-2);`, isRead: `sum += carried.charCodeAt(0);`, isReplaced: `carried = "";`, isKept: `kept.push(carried);` },
  },
  bound: {
    declares: `let carried = 0; let far = 40;`,
    usual: `carried++; if (at >= far) break;`,
    left: `carried + ":" + far`,
    rare: { comesNearer: `far = at + 2;`, becomesAFraction: `far = at + 2.5;`, theCounterJumps: `at += 3;`, theCounterGoesBack: `if (carried < 60) at -= 2;` },
  },
};

/** `R` is the rare way. */
const whens: Record<string, string> = {
  once: `if (at === 23) { R }`,
  onTheFirstTurn: `if (at === 0) { R }`,
  onTheLastTurn: `if (at === 39) { R }`,
  nowAndThen: `if (at % 16 === 15) { R }`,
  onceAndSkipsTheRest: `if (at === 23) { R continue; }`,
  onceAndLeaves: `if (at === 23) { R break; }`,
  inAHandler: `try { fail(at === 23); } catch { R }`,
  underAHandlerOutsideTheLoop: `if (at === 23) { R fail(now === 2); }`,
  inAnInnerLoop: `if (at === 23) for (let inner = 0; inner < 2; inner++) { R }`,
  byWhatAListHolds: `if (marks[at] === undefined) { R }`,
  never: `if (at === 400) { R }`,
};

/** A place may write the turn as a literal, which TypeScript does not let a stretch compare with another. */
const named = (stretch: Stretch): Stretch => ({ ...stretch, body: turn => `const now: number = ${turn}; ${stretch.body("now")}` });

export const oneIn = 150;

export function programs(isTyped?: boolean) {
  const all: Stretch[] = [];
  for (const kind in carried)
    for (const rare in carried[kind].rare)
      for (const when in whens)
        for (const order of ["rareFirst", "usualFirst"])
          all.push({
            name: `${kind}-${rare}-${when}-${order}`,
            beside,
            before: seed => `let sum = 0; const kept: unknown[] = []; const start = ${seed}; const marks: (number | undefined)[] = []; for (let at = 0; at < 40; at++) marks.push(at === 29 ? undefined : at);`,
            body: () => {
              const rarely = whens[when].replace("R", () => carried[kind].rare[rare]);
              return `${carried[kind].declares} for (let at = 0; at < 40; at++) { ${order === "rareFirst" ? rarely + " " + carried[kind].usual : carried[kind].usual + " " + rarely} sum++; } say(${carried[kind].left});`;
            },
            after: `sum + ":" + kept.length`,
          });
  return alsoWithTypesErased(inEveryPlace(all.map(named), isTyped), isTyped);
}
