// A tool asks whether it has a command before it loads it. `existsSync` said false of a file that `require` finds: "unknown command", in silence.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import fs from "node:fs";
import path from "node:path";
const run = name => {
  const file = path.join(import.meta.dir, "../commands", name + ".cjs");
  console.log(fs.existsSync(file) ? require(file).said : "unknown command: " + name);
};
for (const name of process.argv.length > 9 ? process.argv.slice(9) : ["build", "deploy", "serve"]) run(name);
