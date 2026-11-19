// A file that JSON refuses throws a SyntaxError at the import or the require(), as under `bun <file>`, with a sentence of the build's own: the parser's words quote the text.
// The executable held the whole text of such a file, to hand it to JSON.parse() at run time: also of every file that a made name under `type: "json"` may name and nobody asks for.
// A file that is named as code and refused as JSON threw "Cannot find module". The last lines read the executable itself.
import { readFileSync } from "node:fs";
import { tag } from "./code/other.mjs";
const [odd, other, list] = JSON.parse('["odd.txt", "other.mjs", "list.mjs"]');
const say = async (label, load) => {
  try {
    console.log(label, JSON.stringify((await load()).default));
  } catch (error) {
    console.log(label, error.name, error instanceof SyntaxError);
  }
};
await say("a made name", () => import("./typed/" + odd, { with: { type: "json" } }));
await say("a made name again", () => import("./typed/" + odd, { with: { type: "json" } }));
await say("a written name", () => import("./own/commented.json"));
await say("a written name, required", () => ({ default: require("./own/commented.json") }));
await say("a file of code that holds JSON", () => import("./code/" + list, { with: { type: "json" } }));
await say("a file of code that the program imports as code too", () => import("./code/" + other, { with: { type: "json" } }));
console.log(tag);
const isExecutable = /\$bunfs|~BUN/.test(import.meta.url);
const own = isExecutable ? readFileSync(process.execPath, "latin1") : "";
const holds = words => own.includes(JSON.parse(words).join("-"));
console.log("the executable holds the line that JSON refuses in typed/odd.txt:", holds('["THE", "LINE", "THAT", "JSON", "REFUSES"]'));
console.log("the executable holds typed/other.txt, which the program never asks for:", holds('["A", "VALUE", "THAT", "NOBODY", "ASKS", "FOR"]'));
console.log("the executable holds the comment of own/commented.json:", holds('["THE", "COMMENT", "OF", "A", "WRITTEN", "FILE"]'));
