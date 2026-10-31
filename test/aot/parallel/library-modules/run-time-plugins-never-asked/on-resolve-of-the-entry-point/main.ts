import { lib } from "./lib";
import legacy from "./legacy.cjs";
import data from "./data.json";
console.log(lib(), legacy.name, data.name);
const asked: string[] = [];
const nameOf = (path: string) => path.split(/[\\/]/).pop()!;
function attempt(register: (build: any) => void): void {
  try {
    Bun.plugin({ name: "probe", setup: register });
    console.log("registered");
  } catch (error: any) {
    console.log(error.name + ": " + error.message);
  }
}

attempt(build =>
  build.onResolve({ filter: /main/ }, (args: any) => (asked.push("resolve:" + nameOf(args.path)), undefined)),
);

console.log("static:", lib(), legacy.name, data.name);
console.log(
  "import():",
  (await import("./lib")).lib(),
  (await import("./legacy.cjs")).default.name,
  (await import("./data.json")).default.name,
);
console.log("require():", require("./lib").lib(), require("./legacy.cjs").name, require("./data.json").name);
console.log(
  "first loaded now:",
  (await import("./late")).lib(),
  (await import("./late")).late,
  (await import("./other")).lib(),
);
console.log("asked:", asked.join(" ") || "nothing");
