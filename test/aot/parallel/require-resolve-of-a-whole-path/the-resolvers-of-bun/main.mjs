import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { held } from "./held.cjs";

const folder = held.folder;
const whole = path.join(folder, "held.cjs");
const read = name => fs.readFileSync(name, "utf8").length;
const made = createRequire(import.meta.url);

const answers = {
  "Bun.resolveSync": Bun.resolveSync(whole, "/"),
  "Bun.resolveSync from a folder": Bun.resolveSync(whole, folder),
  "Bun.resolve": await Bun.resolve(whole, "/"),
  "import.meta.resolveSync": import.meta.resolveSync(whole),
  "createRequire().resolve": made.resolve(whole),
  "require.resolve": require.resolve(whole),
};
for (const [name, answer] of Object.entries(answers)) {
  console.log(name, answer === whole, read(answer) === held.length);
}
