// `text.replace(pattern, mark => ..)` is how a text is escaped, and in most texts there is nothing to escape. Where the text and the pattern are known for what they are, such a call entered the run time
// before anybody had looked whether the pattern is found; only a replacement known to be a text was spared that.
// COUNT: operation:operationAOTStringReplaceRegExp <= 200
// COUNT: operation:operationAOTStringReplaceRegExpWithFunction <= 200
// COUNT: operation:operationAOTStringReplaceRegExpString <= 200
const marks = /[&<>"']/g;
const first = /[&<>]/;
const names: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function nameOf(mark: string): string { return names[mark]!; }
function escaped(text: string): string { return text.replace(marks, mark => names[mark]!); }
function escapedByName(text: string): string { return text.replace(first, nameOf); }
function replacedBy(text: string, by: any): string { return text.replace(marks, by); }
const clean = ["12 ab", "345", "b x", "a, b", "", "Z9"];
let length = 0;
for (let round = 0; round < 2000; round++) {
  for (const text of clean) {
    length += escaped(text).length + escapedByName(text).length;
    length += replacedBy(text, round & 1 ? nameOf : "-").length;
  }
}
console.log(length);

const said: string[] = [];
function attempt(deed: () => unknown): string {
  try { return JSON.stringify(deed()); } catch (error) { return (error as Error).name; }
}
class Named { constructor(public mark: string) {} }
const replacements: [string, () => unknown][] = [
  ["a text", () => "[$&]"],
  ["an arrow", () => (mark: string, at: number) => `${mark}@${at}`],
  ["a function", () => nameOf],
  ["a bound function", () => nameOf.bind(null)],
  ["a built-in", () => String],
  ["a class", () => Named],
  ["a proxy of a function", () => new Proxy(nameOf, {})],
  ["undefined", () => undefined],
  ["null", () => null],
  ["a number", () => 7],
  ["a big integer", () => 7n],
  ["a boolean", () => false],
  ["a symbol", () => Symbol("mark")],
  ["a list", () => ["a", "b"]],
  ["an object that says when it is asked", () => ({ toString() { said.push(`  asked for its text while lastIndex is ${marks.lastIndex}`); return "!"; } })],
  ["an object that refuses", () => ({ toString() { throw new RangeError("no text"); } })],
];
for (const [name, make] of replacements) {
  for (const text of ["nothing here", "a<b & c", ""]) {
    marks.lastIndex = 2;
    said.push(`${name}, ${JSON.stringify(text)}: ${attempt(() => replacedBy(text, make()))}, lastIndex ${marks.lastIndex}`);
  }
}
const frozen = Object.freeze(/[&<>]/g);
const late = /[&<>]/g;
late.lastIndex = 3;
Object.freeze(late);
for (const [name, pattern] of [["frozen", frozen], ["frozen at 3", late]] as const)
  for (const text of ["nothing here", "a<b"])
    said.push(`${name}: ${attempt(() => text.replace(pattern, mark => names[mark]!))} ${attempt(() => text.replace(pattern, "-"))}`);
console.log(said.join("\n"));
