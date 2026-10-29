// A function marks a place, does something that needs room on the stack, and takes the mark away: in order, in a `finally`, in a `catch`, by a disposal.
// It runs at every depth close to the end of the stack. Where the room does not suffice a RangeError leaves the function, and whoever catches it finds no mark:
// the mark is taken away ahead of the call, or by the handler around it. A handler whose `try` has ended runs for nothing that comes behind it.
// A program holds one place, one guard, one call and one way to reach the function.

/** Where the mark is: what the program declares, how it is set and cleared, and how it is read. */
export const places: readonly {
  name: string;
  declares: string;
  set: string;
  clear: string;
  read: string;
  /** What stands around the function, where the place is in sight of nothing else. */
  around?: (last: string) => string;
  clearOutside?: string;
}[] = [
  { name: "a variable of the module", declares: `let mark = 0;`, set: `mark = 1;`, clear: `mark = 0;`, read: `mark` },
  {
    name: "a field",
    declares: `const holder = { mark: 0 };`,
    set: `holder.mark = 1;`,
    clear: `holder.mark = 0;`,
    read: `holder.mark`,
  },
  {
    name: "an element",
    declares: `const marks = [0];`,
    set: `marks[0] = 1;`,
    clear: `marks[0] = 0;`,
    read: `marks[0]`,
  },
  {
    name: "a byte",
    declares: `const bytes = new Uint8Array(1);`,
    set: `bytes[0] = 1;`,
    clear: `bytes[0] = 0;`,
    read: `bytes[0]`,
  },
  {
    name: "a variable of a closure",
    declares: ``,
    set: `mark = 1;`,
    clear: `mark = 0;`,
    read: `readMark()`,
    around: last =>
      `const [last, readMark, clearMark] = (() => {\nlet mark = 0;\n${last}\nreturn [last, () => mark, () => {\nmark = 0;\n}];\n})();`,
    clearOutside: `clearMark();`,
  },
  {
    name: "a static field",
    declares: `class Marked {\nstatic mark = 0;\n}`,
    set: `Marked.mark = 1;`,
    clear: `Marked.mark = 0;`,
    read: `Marked.mark`,
  },
  { name: "a counter", declares: `let mark = 0;`, set: `mark++;`, clear: `mark--;`, read: `mark` },
];

/** What needs room. `turn` differs from call to call, `list` is a list of numbers, `isOn` is true and only the run knows it. */
export const calls: readonly {
  name: string;
  declares?: string;
  text: string;
  /** Whether a later call succeeds hangs on how the first one ended. */
  hangsOnTheFirstCall?: true;
}[] = [
  { name: "require of a file", text: `kept = require("./leaf.mjs");`, hangsOnTheFirstCall: true },
  { name: "import of a file", text: `kept = import("./leaf.mjs");` },
  { name: "structuredClone", text: `kept = structuredClone(list);` },
  { name: "JSON.stringify", text: `kept = JSON.stringify(list);` },
  { name: "a sort", text: `kept = list.toSorted((a, b) => a - b);` },
  { name: "a new Map", text: `kept = new Map([[turn, turn]]);` },
  { name: "a literal", text: `kept = { turn, list: [turn, turn] };` },
  { name: "a text", text: "kept = `${turn}-${list}`;" },
  { name: "a pattern", text: `kept = /(a+)b/.exec("aab" + turn);` },
  { name: "a member of process", text: `kept = process.versions;` },
  {
    name: "a function that calls itself",
    declares: `let total = 0;\nfunction count(left) {\ntotal++;\nreturn left > 0 ? count(left - 1) + 1 : total;\n}`,
    text: `kept = count(turn & 3);`,
  },
  {
    name: "a function out of a list",
    declares: `let total = 0;\nconst table = [left => (total += left), left => (total -= left), globalThis.nothingOfThisName ?? (left => left)];`,
    text: `kept = table[turn % 3](1);`,
  },
  {
    name: "a getter",
    declares: `const source = {\nget value() {\nreturn [turn];\n},\n};`,
    text: `kept = source.value;`,
  },
  {
    name: "a constructor",
    declares: `class Made {\nconstructor(from) {\nthis.from = from;\nthis.list = [from];\n}\n}`,
    text: `kept = new Made(turn);`,
  },
  { name: "a throw", text: `if (isOn) throw new RangeError("thrown by the program");` },
  { name: "a number in an object", text: `kept = new Number(turn);` },
  { name: "a boolean in an object", text: `kept = new Boolean(turn);` },
  { name: "a date out of seven numbers", text: `kept = new Date(2020, 1, 2, 3, 4, 5, turn);` },
  {
    name: "a text out of nine numbers",
    text: `kept = String.fromCharCode(65, 66, 67, 68, 69, 70, 71, 72, 65 + (turn & 7));`,
  },
];

/** How the mark is set and taken away around the call. */
export const guards: readonly {
  name: string;
  text: (set: string, clear: string, call: string) => string;
  /** The mark is taken away by a call, for which the room may not suffice either: such a program only has to end in order, whatever errors it meets. */
  clearsByACall?: true;
}[] = [
  { name: "cleared ahead of the call", text: (set, clear, call) => `${set}\nif (!isOn) return 1;\n${clear}\n${call}` },
  {
    name: "cleared in either arm",
    text: (set, clear, call) => `${set}\nif (isOn) {\n${clear}\n${call}\n} else {\n${clear}\n}`,
  },
  { name: "finally", text: (set, clear, call) => `${set}\ntry {\n${call}\n} finally {\n${clear}\n}` },
  {
    name: "finally behind a test",
    text: (set, clear, call) => `${set}\ntry {\nif (!isOn) return 1;\n${call}\n} finally {\n${clear}\n}`,
  },
  {
    name: "catch",
    text: (set, clear, call) => `${set}\ntry {\n${call}\n} catch (error) {\n${clear}\nthrow error;\n}\n${clear}`,
  },
  {
    name: "two finally blocks",
    text: (set, clear, call) =>
      `${set}\ntry {\ntry {\n${call}\n} finally {\nkept = undefined;\n}\n} finally {\n${clear}\n}`,
  },
  {
    name: "behind a try that has ended",
    text: (set, clear, call) =>
      `${set}\ntry {\nprobe(turn & 3);\n} catch {\nif (++handled > 1000) {\nconsole.log("a handler runs again and again");\nprocess.exit(1);\n}\n}\n${clear}\n${call}`,
  },
  {
    name: "using",
    clearsByACall: true,
    text: (set, clear, call) => `${set}\nusing held = {\n[Symbol.dispose]() {\n${clear}\n},\n};\n${call}`,
  },
];

/** How the recursion comes to the function. */
export const ways: readonly { name: string; declares: string; last: string }[] = [
  { name: "called by name", declares: ``, last: `last` },
  { name: "out of a list", declares: `const lasts = [last, () => 0];`, last: `lasts[Number(!isOn)]` },
];

export const files = { "leaf.mjs": "export const v = 1;\n" };

export type Case = {
  place: (typeof places)[number];
  guard: (typeof guards)[number];
  call: (typeof calls)[number];
  way: (typeof ways)[number];
};

export const nameOf = ({ place, guard, call, way }: Case) => [call.name, guard.name, place.name, way.name].join(" | ");

export function programOf({ place, guard, call, way }: Case) {
  // How many frames the call needs follows from the size of a frame: the walk comes to the depth where the call has room.
  const goesOn = call.text.startsWith("kept =") && !call.hangsOnTheFirstCall ? " || (kept === undefined && turn <= 5000)" : "";
  return `const isOn = process.argv.length > 0;
const list = [3, 1, 2];
let kept;
let turn = 0;
let reached = 0;
let left = 0;
let handled = 0;
let probed = 0;
function probe(more) {
probed++;
return more > 0 ? probe(more - 1) + 1 : probed;
}
const strange = new Set();
process.on("unhandledRejection", () => {});
${place.declares}
${call.declares ?? ""}
${(place.around ?? (text => text))(`function last() {\n${guard.text(place.set, place.clear, call.text)}\nreturn 0;\n}`)}
${way.declares}
function descend(depth, run) {
reached++;
return depth > 0 ? descend(depth - 1, run) + 1 : run();
}
let limit = 0;
let goal = 1e9;
for (turn = 0; turn <= 200${goesOn}; turn++) {
reached = 0;
try {
descend(goal, ${way.last});
} catch (error) {
if (!(error instanceof RangeError) && !String(error).includes("call stack")) strange.add(String(error));
if (${place.read}) left++;
${place.clearOutside ?? (place.clear.includes("--") ? "mark = 0;" : place.clear)}
}
if (turn === 0) limit = reached;
goal = limit + 20 - turn;
}
await new Promise(resolve => setTimeout(resolve, 5));
console.log("found the mark:", ${guard.clearsByACall ? "typeof left, typeof strange" : "left, [...strange].join()"}, typeof ${call.hangsOnTheFirstCall ? "typeof kept" : "kept"});
`;
}

/** Every call under every guard, four times over: the place and the way go round. */
export function testCases() {
  const cases: Case[] = [];
  for (let round = 0; round < 4; round++)
    calls.forEach((call, callIndex) =>
      guards.forEach((guard, guardIndex) =>
        cases.push({
          call,
          guard,
          place: places[(callIndex + guardIndex * 2 + round * 3) % places.length],
          way: ways[(callIndex + guardIndex + round) % ways.length],
        }),
      ),
    );
  return cases;
}

export const pickCase = (pick: <T>(items: readonly T[]) => T): Case => ({
  place: pick(places),
  guard: pick(guards),
  call: pick(calls),
  way: pick(ways),
});
