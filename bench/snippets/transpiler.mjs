import { readFileSync } from "fs";

var transformSync;
var opts;
if (process.isBun) {
  const transpiler = new Bun.Transpiler({ loader: "jsx" });
  transformSync = transpiler.transformSync.bind(transpiler);
  opts = "jsx";
} else if (process.env["USE_ESBUILD"]) {
  try {
    const esbuild = await import("esbuild");
    transformSync = esbuild.transformSync;
    opts = { loader: "jsx" };
  } catch (exception) {
    throw exception;
  }
} else if (process.env["USE_SWC"]) {
  try {
    const swc = await import("@swc/core");
    transformSync = swc.transformSync;
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
}

const code = readFileSync("src/test/fixtures/simple.jsx", "utf8");

transformSync(code, opts);
