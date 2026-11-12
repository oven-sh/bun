// A method, a static or a getter of net.BlockList or module.SourceMap is used many times, then replaced by a value, stored to, made an accessor, put back and deleted, each time under a name that the build cannot read: each use answers as plain Bun does. Node.js makes these members configurable, so nothing refuses a change.
import { SourceMap } from "node:module";
import { BlockList } from "node:net";

const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

const list = new BlockList();
list.addAddress("10.0.0.1");
const map = new SourceMap({ version: 3, file: "a.js", sources: ["a.ts"], sourcesContent: [], names: [], mappings: "AAAA", sourceRoot: "" }, { lineLengths: [4, 2] });
const loose = (value: unknown): any => value;
const mappingsOf = (payload: unknown): unknown => (typeof payload === "object" && payload !== null ? loose(payload).mappings : payload);

const checkOf = (holder: BlockList): unknown => holder.check("10.0.0.1");
const isBlockListOf = (): unknown => BlockList.isBlockList(list);
const rulesOf = (holder: BlockList): unknown => holder.rules;
const payloadOf = (holder: SourceMap): unknown => mappingsOf(holder.payload);

function all(label: string, holder: object, name: string, typed: () => unknown, untyped: () => unknown) {
  const original = Object.getOwnPropertyDescriptor(holder, name)!;
  const isMethod = "value" in original;
  const both = () => [typed(), untyped()];
  const many = () => {
    let alike = 0;
    const first = JSON.stringify(both());
    for (let turn = 0; turn < 200; turn++) if (JSON.stringify(both()) === first) alike++;
    return [first, alike];
  };
  // In the place of a method stands a function, and in the place of a getter what it would answer.
  const standIn = (text: string) => (isMethod ? () => text : text);
  say(label + " has a descriptor that may be redefined", () => [original.configurable, original.enumerable, typeof (isMethod ? original.value : original.get)]);
  say(label + " used many times", many);
  say(label + " replaced by a value", () => (Object.defineProperty(holder, name, { value: standIn("replaced"), writable: true, configurable: true }), both()));
  say(label + " stored to", () => (((holder as Record<string, unknown>)[name] = standIn("stored")), both()));
  say(label + " replaced by a getter", () => (Object.defineProperty(holder, name, { get: () => standIn("from a getter"), configurable: true }), both()));
  say(label + " put back", () => (Object.defineProperty(holder, name, original), both()));
  say(label + " deleted", () => [delete (holder as Record<string, unknown>)[name], name in holder]);
  say(label + " put back again", () => (Object.defineProperty(holder, name, original), many()));
}

all("BlockList.prototype.check", BlockList.prototype, "check", () => checkOf(list), () => loose(list).check("10.0.0.1"));
all("BlockList.isBlockList", BlockList, "isBlockList", isBlockListOf, () => loose(BlockList).isBlockList(list));
all("BlockList.prototype.rules", BlockList.prototype, "rules", () => rulesOf(list), () => loose(list).rules);
all("SourceMap.prototype.payload", SourceMap.prototype, "payload", () => payloadOf(map), () => mappingsOf(loose(map).payload));
// The declarations of @types/node have no lineLengths.
all("SourceMap.prototype.lineLengths", SourceMap.prototype, "lineLengths", () => loose(map).lineLengths, () => loose(map)["lineLengths"]);
console.log(lines.join("\n"));
