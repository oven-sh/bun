// A table, no seeds: a regular expression whose source no text of the program holds, with a run that has no upper bound in front of something that fails, asked of a subject in which such a run begins at many places of one stretch.
//
//   the run x what stands around it (a lookahead with a group and its reference, a reference inside, a repeated group ..) x how many alternatives x the subject's length, tail and units x the flags x what is asked
//
// The index, every group and lastIndex are printed. A long text is printed as its length and a sum.
type Named = { name: string; text: string };

const runs: readonly Named[] = [
  { name: ".+?", text: ".+?" },
  { name: ".+", text: ".+" },
  { name: ".*?", text: ".*?" },
  { name: ".{2,}?", text: ".{2,}?" },
  { name: "[^\\n]*", text: "[^\\n]*" },
  { name: "[^]*?", text: "[^]*?" },
  { name: "\\S+?", text: "\\S+?" },
  { name: "[^c]+", text: "[^c]+" },
];

/** `R` is the run, `C` a letter of the alternative's own, `N` the number of its first group, `M` of its second. `groups` is how many it has. What `standsAlone` has no place for a run or for further alternatives. What `goesBackOften` takes plain Bun half a second at forty units. */
/** So many letters in a row, each between `open` and `close`. */
const inARow = (count: number, open: string, close: string) =>
  Array.from({ length: count }, (_, at) => open + String.fromCharCode(97 + (at % 26)) + close).join("");

const bodies: readonly (Named & { groups: number; standsAlone?: true; goesBackOften?: true })[] = [
  { name: "a lookahead with a group and its reference behind it", text: "\\[(?=(R\\]\\(C))\\N", groups: 1 },
  { name: "a reference inside the lookahead", text: "\\[(?=(.)(R\\N\\(C))\\M", groups: 2 },
  { name: "a reference behind the run in the same alternative", text: "\\[(R)\\]\\(\\NC", groups: 1 },
  { name: "the run in a repeated group", text: "(?:\\[R\\]\\()+C", groups: 0, goesBackOften: true },
  { name: "the run in a repeated group that is kept", text: "(\\[R\\]\\()+C\\N?", groups: 1, goesBackOften: true },
  { name: "the run in a lookahead that must fail", text: "\\[(?!R\\]\\(C)(a)\\N?", groups: 1 },
  { name: "the run and nothing else", text: "\\[R\\]\\(C", groups: 0 },
  { name: "a lookbehind in front of the run", text: "(?<=(\\[))R\\]\\(C", groups: 1 },
  {
    name: "a group repeated as seldom as possible in front of its reference",
    text: "(?:(a)+?)\\1(c)",
    groups: 2,
    standsAlone: true,
  },
  {
    name: "a choice repeated as seldom as possible in front of its reference",
    text: "(?:(a|b)+?)\\1c",
    groups: 1,
    standsAlone: true,
  },
  {
    name: "a group repeated one to three times in front of its reference",
    text: "(?:(a){1,3}?)\\1c",
    groups: 1,
    standsAlone: true,
  },
  { name: "forty optional groups in a row", text: inARow(40, "(", ")?"), groups: 40, standsAlone: true },
  { name: "twenty-four optional groups in a row", text: inARow(24, "(", ")?"), groups: 24, standsAlone: true },
  { name: "forty optional groups that are not kept", text: inARow(40, "(?:", ")?"), groups: 0, standsAlone: true },
  {
    name: "forty groups, optional and as seldom as possible",
    text: inARow(40, "(", ")??"),
    groups: 40,
    standsAlone: true,
  },
  {
    name: "forty optional groups in front of what fails",
    text: inARow(40, "(", ")?") + "!!",
    groups: 40,
    standsAlone: true,
  },
  { name: "a loop over two like alternatives at the beginning", text: "(?:a|a)*b", groups: 0, standsAlone: true },
  {
    name: "a kept loop over two like alternatives at the beginning",
    text: "((?:a|a)*b)\\1?",
    groups: 1,
    standsAlone: true,
  },
];

const alternatives = [1, 2, 5, 12];

/** The subject is `unit` so many times and a tail. */
const units: readonly Named[] = [
  { name: "[a](", text: "[a](" },
  { name: "[ab](", text: "[ab](" },
  { name: "[a](, a line each", text: "[a](\n" },
  { name: "aab", text: "aab" },
];
const lengths = [0, 1, 2, 7, 40, 300, 1500, 6000];
/** `Z` is the letter of the last alternative. */
const tails: readonly Named[] = [
  { name: "nothing", text: "" },
  { name: "what matches nothing", text: "[a]" },
  { name: "what the last alternative matches", text: "[a](Z" },
  { name: "what the last alternative matches with its reference", text: "[a](aZ" },
  { name: "a unit outside Latin-1 at the end", text: "[a](ā" },
  { name: "a unit outside Latin-1 at the beginning", text: "" },
  { name: "c", text: "aac" },
];

const flags = ["", "s", "i", "u", "v", "g", "y", "gs", "iu", "m"];

/** `p` is the pattern, `s` the subject. */
const asked: readonly (Named & { isForAll?: true })[] = [
  { name: "exec", text: "shown(p.exec(s)) + at(p)" },
  { name: "exec from 1", text: "((p.lastIndex = 1), shown(p.exec(s)) + at(p))" },
  { name: "exec twice", text: "shown(p.exec(s)) + at(p) + shown(p.exec(s)) + at(p)" },
  { name: "test", text: "String(p.test(s)) + at(p)" },
  { name: "match", text: "shown(s.match(p)) + at(p)" },
  { name: "search", text: "String(s.search(p)) + at(p)" },
  { name: "replace", text: 'short(s.replace(p, "<$1|$&>")) + at(p)' },
  { name: "split", text: "shown(s.split(p, 5)) + at(p)" },
  { name: "matchAll", text: "shown([...s.matchAll(p)].slice(-2).flat()) + at(p)", isForAll: true },
];

const crossed = bodies.flatMap(body =>
  (body.standsAlone ? runs.slice(0, 1) : runs).flatMap(run =>
    (body.standsAlone ? [1] : alternatives).flatMap(count =>
      units.flatMap(unit =>
        lengths.flatMap(length =>
          tails.flatMap(tail =>
            flags.flatMap(flag =>
              asked
                .filter(asks => !asks.isForAll || flag.includes("g"))
                .filter(
                  asks => !body.goesBackOften || length <= 7 || (length === 40 && asks.name === "exec" && flag === ""),
                )
                // The longest subjects are for one question of each kind: a run takes its time under plain Bun too.
                .filter(asks => length < 1500 || asks.name === "exec" || asks.name === "replace")
                .filter(() => length < 1500 || count < 12 || flag === "" || flag === "u")
                .filter(
                  asks => length < 6000 || (asks.name === "exec" && flag === "" && count >= 5 && !body.goesBackOften),
                )
                .map(asks => ({ body, run, count, unit, length, tail, flag, asks })),
            ),
          ),
        ),
      ),
    ),
  ),
);

export const inOne = 40;
// Every thirteenth case of the table: its neighbors differ in the question alone.
const taken = crossed.filter((_, at) => at % 13 === 0);
export const programs = Math.ceil(taken.length / inOne);
export const cases = taken.length;

const letters = "CDEFGHJKLMNP";

export function sourceOf(body: (typeof bodies)[number], run: Named, count: number): string {
  let first = 1;
  return Array.from({ length: count }, (_, at) => {
    const text = body.text
      .replaceAll("R", run.text)
      .replaceAll("\\N", `\\${first}`)
      .replaceAll("\\M", `\\${first + 1}`)
      .replaceAll("C", body.standsAlone ? "C" : letters[at]);
    first += body.groups;
    return text;
  }).join("|");
}

export function programOf(index: number): { file: string; text: string } {
  const first = index * inOne;
  // A stride that shares no factor with the length of the table takes a program from all over it.
  const stride = 7919;
  const lines = Array.from({ length: Math.min(taken.length, first + inOne) - first }, (_, at) => {
    const { body, run, count, unit, length, tail, flag, asks } = taken[((first + at) * stride) % taken.length];
    const source = sourceOf(body, run, count);
    const pieces = source.match(/[^]{1,3}/g)!;
    const last = letters[count - 1];
    const head = tail.name === "a unit outside Latin-1 at the beginning" ? "ā" : "";
    const label = `${body.name}, ${run.name}, ${count} | ${unit.name} x ${length}, ${tail.name} | ${flag || "no flag"} | ${asks.name}`;
    return `say(${JSON.stringify(label)}, ${JSON.stringify(pieces)}, ${JSON.stringify(flag)}, ${JSON.stringify(head)} + ${JSON.stringify(unit.text)}.repeat(${length}) + ${JSON.stringify(tail.text.replaceAll("Z", last))}, (p, s) => ${asks.text});`;
  });
  return {
    file: "main.mjs",
    text: `const nothing = String(Date.now()).slice(99);
function short(text) {
  if (typeof text !== "string" || text.length < 40) return JSON.stringify(text) ?? "undefined";
  let sum = 0;
  for (let at = 0; at < text.length; at++) sum = (Math.imul(sum, 31) + text.charCodeAt(at)) | 0;
  return text.length + "#" + (sum >>> 0).toString(16);
}
function shown(found) {
  return found === null ? "null" : (found.index ?? "") + "[" + Array.from(found, short).join() + "]";
}
function at(pattern) {
  return " " + pattern.lastIndex + " ";
}
function say(label, pieces, flags, subject, ask) {
  let line;
  try {
    line = ask(new RegExp(pieces.join(nothing), flags + nothing), subject + nothing);
  } catch (error) {
    line = "THROWS " + error.constructor.name;
  }
  console.log(label + ": " + line);
}
${lines.join("\n")}
`,
  };
}
