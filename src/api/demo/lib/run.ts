import { transform as _transform, initialize } from "esbuild-wasm";
import initSwc, { transformSync as transformSyncSWC } from "@swc/wasm-web";
import { Bun } from "./api";

export async function start() {
  await initialize({
    worker: false,
    wasmURL: "/node_modules/esbuild-wasm/esbuild.wasm",
  });
  await Bun.init("/bun-wasm.wasm");
  await initSwc("/node_modules/@swc/wasm-web/wasm_bg.wasm");
}

const swcOptions = {
  sourceMaps: false,
  inlineSourcesContent: false,
  jsc: {
    target: "es2022",
    parser: {
      jsx: true,
      syntax: "typescript",
      tsx: false,
      decorators: false,
      dynamicImport: false,
    },
  },
};

export async function transform(contents, file) {
  var result: any = {
    timings: {
      esbuild: 0,
      bun: 0,
      swc: 0,
    },
  };
  result.timings.esbuild = performance.now();
  result.esbuild = await _transform(contents, {
    sourcefile: file,
    loader: file.substring(file.lastIndexOf(".") + 1),
  });
  result.timings.esbuild = performance.now() - result.timings.esbuild;

  result.timings.bun = performance.now();
  result.bun = Bun.transformSync(contents, file);
  result.timings.bun = performance.now() - result.timings.bun;

  if (file.substring(file.lastIndexOf(".") + 1) === "tsx") {
    swcOptions.jsc.parser.tsx = true;
    swcOptions.jsc.parser.syntax = "typescript";
  } else if (file.substring(file.lastIndexOf(".") + 1) === "jsx") {
    swcOptions.jsc.parser.tsx = false;
    swcOptions.jsc.parser.jsx = true;
    swcOptions.jsc.parser.syntax = "typescript";
  } else {
    swcOptions.jsc.parser.tsx = false;
    swcOptions.jsc.parser.jsx = false;
    swcOptions.jsc.parser.syntax = "javascript";
  }

  result.timings.swc = performance.now();
  result.swc = transformSyncSWC(contents, swcOptions as any);
  result.timings.swc = performance.now() - result.timings.swc;

  console.log("esbuild:", result.timings.esbuild, "ms");
  console.log("Bun:", result.timings.bun, "ms");
  console.log("SWC:", result.timings.swc, "ms");

  return result;
}
