// Plugins for what is no module of the program register and run.
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

attempt(build => build.onLoad({ filter: /\.yaml$/ }, () => ({ exports: { value: "from plugin" }, loader: "object" })));
attempt(build =>
  build.onLoad({ filter: /lib/, namespace: "virtual" }, () => ({
    exports: { value: "from namespace" },
    loader: "object",
  })),
);
attempt(build =>
  build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" })),
);
attempt(build => build.module("my-virtual", () => ({ exports: { value: "from module" }, loader: "object" })));
attempt(build => build.module("shared-lib", () => ({ exports: { lib }, loader: "object" })));
const yamlPath = require("node:path").join(require("node:os").tmpdir(), `written-${process.pid}.yaml`);
await Bun.write(yamlPath, "value: from file");
console.log((await import(yamlPath)).value);
require("node:fs").rmSync(yamlPath);
console.log((await import(["virtual", "lib"].join(":"))).value);
console.log((await import(["my", "virtual"].join("-"))).value);
console.log((await import(["shared", "lib"].join("-"))).lib === lib);
