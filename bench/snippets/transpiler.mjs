import { readFileSync } from "fs";

var transformSync;
var transform;
var opts;
if (process.isBun) {
  const transpiler = new Bun.Transpiler({ loader: "jsx" });
  transformSync = transpiler.transformSync.bind(transpiler);
  transform = transpiler.transform.bind(transpiler);
  opts = "jsx";
} else if (process.env["esbuild"]) {
  try {
    const esbuild = await import("esbuild");
    transformSync = esbuild.transformSync;
    transform = esbuild.transform;
    opts = { loader: "jsx" };
  } catch (exception) {
    throw exception;
  }
} else if (process.env["swc"]) {
  try {
    const swc = await import("@swc/core");
    transformSync = swc.transformSync;
    transform = swc.transform;
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
} else if (process.env["babel"]) {
  try {
    const swc = await import("@babel/core");
    transformSync = swc.transformSync;
    transform = swc.transform;
    opts = {
      sourceMaps: false,
      presets: [(await import("@babel/preset-react")).default],
    };
  } catch (exception) {
    throw exception;
  }
}

const code = readFileSync("src/test/fixtures/simple.jsx", "utf8");

if (process.env.ASYNC) {
  console.log(await transform(code, opts));
} else {
  console.log(transformSync(code, opts));
}
