// Reference: bun build --compile
import { createRequire } from "node:module";
Bun.plugin({
  name: "swap",
  setup(build) {
    build.onResolve({ filter: /^os$/, namespace: "node" }, (args) => ({ path: args.path, namespace: "swapped" }));
    build.onLoad({ filter: /.*/, namespace: "swapped" }, () => ({ exports: { platform: () => "plugin" }, loader: "object" }));
  },
});
const made = createRequire(process.cwd() + "/absent.js");
const alias = made;
const count = process.argv.length;
const kind = (os) => (os.platform() === "plugin" ? "plugin" : "library");
console.log(kind(made("node:os")), kind(alias("node:os")), kind(made(count > 5 ? "node:path" : "node:os")), kind(createRequire(process.cwd() + "/absent.js")("node:os")));
console.log(kind(made("os")), kind(alias("os")), kind(made(count > 5 ? "path" : "os")));
