// A function sets a marker, does something that needs stack space, and clears the marker: in sequence, in a `finally`,
// in a `catch`, or by disposal. It runs at every depth close to the stack limit. When a RangeError leaves the function,
// the handler must find the marker cleared.

/** Where the marker is: what the program declares, how it is set and cleared, and how it is read. */
export const places: readonly {
  name: string;
  declares: string;
  set: string;
  clear: string;
  read: string;
  /** What surrounds the function, if the location is not visible otherwise. */
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

// A body that uses more locals than there are registers and calls nothing.
const manyLocals = Array.from({ length: 48 }, (_, at) => `p${at}`);
const bodyOfManyLocals = `const ${manyLocals.map((name, at) => `${name} = (seed + ${at + 1}) | 0`).join(", ")};\nreturn ${manyLocals.join(" + ")};`;

/**
 * What needs stack space. `turn` differs from call to call, `list` is an array of numbers, `isOn` is true but only
 * known at run time.
 */
export const calls: readonly {
  name: string;
  declares?: string;
  text: string;
  /** Whether a later call succeeds depends on how the first one ended. */
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
  {
    name: "a function of many locals",
    declares: `function wide(seed) {\n${bodyOfManyLocals}\n}`,
    text: `kept = wide(turn);`,
  },
  {
    name: "a getter of many locals",
    declares: `const wide = {\nseed: 0,\nget sum() {\nconst seed = this.seed;\n${bodyOfManyLocals}\n},\n};`,
    text: `kept = ((wide.seed = turn), wide.sum);`,
  },
  {
    name: "a method of many locals",
    declares: `const wide = {\nseed: 0,\nsum() {\nconst seed = this.seed;\n${bodyOfManyLocals}\n},\n};`,
    text: `kept = ((wide.seed = turn), wide.sum());`,
  },
  {
    name: "a chain of methods whose first callback counts",
    declares: `let counted = 0;\nfunction wide(seed) {\n${bodyOfManyLocals}\n}`,
    text: `counted = 0;\ntry {\nkept = list\n.map(item => {\ncounted++;\nreturn item;\n})\n.filter(item => wide(item) > 0);\n} catch (error) {\nif (counted % list.length) strange.add("a method was caught halfway");\nthrow error;\n}`,
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

/** How the marker is set and cleared around the call. */
export const guards: readonly {
  name: string;
  text: (set: string, clear: string, call: string) => string;
  /**
   * The marker is cleared by a call, which may also run out of stack: such a program only has to exit cleanly, whatever
   * errors it hits.
   */
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

/** How the recursion reaches the function. */
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
  // How many frames the call needs depends on the frame size: the probe finds the depth at which the call just fits.
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

/** Every call under every guard, four times over: the location and the path rotate. */
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
