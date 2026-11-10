import byDefault from "./key";
import { handed, step as starred } from "./again";
import { make, Proto } from "./pack/proto.mjs";
let keep = Date.now() > 0 ? 1 : 0;
const stack = () => new Error("made up").stack ?? "";
const second = (text: string) => (text.split("\n")[2] ?? "").replace(/\(.*[/\\]/, "(").replace(/:\d+:\d+\)/, ")").trim();
const holder = {
  [handed + "/handed"]() { const s = stack(); return keep > 0 ? s : ""; },
  [starred + "/starred"]() { const s = stack(); return keep > 0 ? s : ""; },
  [byDefault]() { const s = stack(); return keep > 0 ? s : ""; },
} as Record<string, () => string>;
const made = make({}) as Record<string, (keep: number) => string>;
const rows: [string, string][] = [
  ["handed on under a new name", holder["~made/Up/step/handed"]()],
  ["through a star", holder["~made/Up/step/starred"]()],
  ["a default export", holder["~made/Up/default"]()],
  ["mjs: an imported const", (Proto as any)["~made/Pack/evaluate"](keep)],
  ["mjs: behind a spread, a sum", made["~made/Pack/evaluate/made"](keep)],
  ["mjs: handed on by the spread", made["~made/Pack/evaluate"](keep)],
];
for (const [name, text] of rows) console.log(name.padEnd(32), second(text));
