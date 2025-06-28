import { readFileSync } from "fs";
import { createRequire } from "module";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { bench, group, run } from "../runner.mjs";
const require = createRequire(import.meta.url);
const esbuild_ = require("esbuild/lib/main");
const swc_ = require("@swc/core");
const babel_ = require("@babel/core");

const code = readFileSync(dirname(fileURLToPath(import.meta.url)) + "/../../src/test/fixtures/simple.jsx", "utf-8");

async function getWithName(name) {
  let transformSync;
  let transform;
  let opts;

  if (name === "bun") {
    const transpiler = new Bun.Transpiler({ loader: "jsx" });
    transformSync = transpiler.transformSync.bind(transpiler);
    transform = transpiler.transform.bind(transpiler);
    opts = "jsx";
  } else if (name === "esbuild") {
    try {
      transformSync = esbuild_.transformSync;
      transform = esbuild_.transform;
      opts = { loader: "jsx" };
    } catch (exception) {
      throw exception;
    }
  } else if (name === "swc") {
    try {
      transformSync = swc_.transformSync;
      transform = swc_.transform;
      opts = {
        sourceMaps: false,
        inlineSourcesContent: false,
        jsc: {
          target: "es2022",
          parser: {
            jsx: true,
          },
        },
      };
    } catch (exception) {
      throw exception;
    }
  } else if (name === "babel") {
    try {
      transformSync = babel_.transformSync;
      transform = babel_.transform;
      opts = {
        sourceMaps: false,
        presets: ["@babel/preset-react"],
      };
    } catch (exception) {
      throw exception;
    }
  }

  return {
    transformSync,
    transform,
    opts,
    name,
  };
}

const bun = process.isBun ? await getWithName("bun") : null;
const esbuild = await getWithName("esbuild");
const swc = await getWithName("swc");
const babel = await getWithName("babel");

const transpilers = [bun, esbuild, swc, babel].filter(Boolean);

group("transformSync (" + ((code.length / 1024) | 0) + " KB jsx file)", () => {
  for (let { name, transformSync, opts } of transpilers) {
    bench(name, () => {
      transformSync(code, opts);
    });
  }
});

group("tranform x 5", () => {
  for (let { name, transform, opts } of transpilers) {
    bench(name, async () => {
      return Promise.all([
        transform(code, opts),
        transform(code + "\n", opts),
        transform("\n" + code + "\n", opts),
        transform("\n" + code + "\n\n", opts),
        transform("\n\n" + code + "\n\n", opts),
      ]);
    });
  }
});

await run();
