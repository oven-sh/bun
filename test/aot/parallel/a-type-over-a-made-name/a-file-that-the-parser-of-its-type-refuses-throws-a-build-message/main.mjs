// A file of data that the parser of its type refuses throws a BuildMessage at the import, with the line and column that `bun <file>` names. The executable said "Cannot find module '/$bunfs/root/typed/odd.txt?toml'".
// The executable holds the place and no byte of the file: what the parser says quotes the text, so the sentence is the build's own. The last lines read the executable itself.
import { basename } from "node:path";
import { readFileSync } from "node:fs";
const [odd, fine] = JSON.parse('["odd.txt", "fine.toml"]');
const say = (label, load) =>
  load().then(
    it => console.log(label, typeof it.default),
    ({ name, level, position: at }) => console.log(label, name, level, at.line, at.column, at.length, basename(at.file)),
  );
await say("a made name, toml", () => import("./typed/" + odd, { with: { type: "toml" } }));
await say("a made name, json5", () => import("./typed/" + odd, { with: { type: "json5" } }));
await say("a made name, xml", () => import("./typed/" + odd, { with: { type: "xml" } }));
await say("a made name, jsonc", () => import("./typed/" + odd, { with: { type: "jsonc" } }));
await say("a made name, toml again", () => import("./typed/" + odd, { with: { type: "toml" } }));
await say("a written name, its own loader", () => import("./own/bad.yaml"));
await say("a written name, its own type", () => import("./own/bad.toml", { with: { type: "toml" } }));
const matched = import.meta.glob("./matched/*.toml");
await say("a file that a pattern matches", matched["./matched/" + fine]);
const isExecutable = /\$bunfs|~BUN/.test(import.meta.url);
const own = isExecutable ? readFileSync(process.execPath, "latin1") : "";
const holds = words => own.includes(JSON.parse(words).join("-"));
console.log("the executable holds the line that toml refuses in typed/odd.txt:", holds('["LINE", "THAT", "TOML", "REFUSES"]'));
console.log("the executable holds typed/other.txt, which the program never asks for:", holds('["A", "VALUE", "THAT", "NOBODY", "ASKS", "FOR"]'));
console.log("the executable holds matched/other.toml, which the program never asks for:", holds('["A", "VALUE", "THAT", "A", "PATTERN", "MATCHES"]'));
console.log("the executable holds the line that yaml refuses in own/bad.yaml:", holds('["THE", "LINE", "OF", "A", "WRITTEN", "FILE"]'));
