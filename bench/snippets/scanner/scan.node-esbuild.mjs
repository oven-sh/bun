import { build, buildSync } from "esbuild";
import { readFileSync } from "fs";
const fixture = ["action", "default", "loader"];
const ITERATIONS = parseInt(process.env.ITERATIONS || "1") || 1;

const opts = {
  metafile: true,
  format: "esm",
  platform: "neutral",
  write: false,
  logLevel: "silent",
  stdin: {
    contents: readFileSync("remix-route.ts", "utf8"),
    loader: "ts",
    sourcefile: "remix-route.js",
  },
};

const getExports = ({ metafile }) => {
  for (let i = 0; i < fixture.length; i++) {
    if (fixture[i] !== metafile.outputs["stdin.js"].exports[i]) {
      throw new Error("Mismatch");
    }
  }
};

console.time("Get exports");

if (!process.env.SYNC) {
  var promises = new Array(ITERATIONS);
  for (let i = 0; i < ITERATIONS; i++) {
    promises[i] = build(opts).then(getExports);
  }

  await Promise.all(promises);
} else {
  for (let i = 0; i < ITERATIONS; i++) {
    getExports(buildSync(opts));
  }
}

console.timeEnd("Get exports");
