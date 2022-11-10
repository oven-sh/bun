import { init, parse } from "es-module-lexer";

import { Bun } from "./api";

export async function start() {
  await init;
  await Bun.init("/bun-wasm.wasm");
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
      lexer: 0,
      bun: 0,
    },
  };
  result.timings.lexer = performance.now();
  result.lexer = await parse(contents, file);
  result.timings.lexer = performance.now() - result.timings.lexer;

  result.timings.bun = performance.now();
  result.bun = Bun.scan(contents, file);
  result.timings.bun = performance.now() - result.timings.bun;

  console.log("lexer:", result.timings.lexer, "ms");
  console.log("Bun:", result.timings.bun, "ms");

  return result;
}
