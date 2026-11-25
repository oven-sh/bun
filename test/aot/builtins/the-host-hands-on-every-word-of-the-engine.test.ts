// src/codegen/builtins/lib.ts hands on what the engine's aot/builtins/generator/lib.ts exports, by a written list: src/tsconfig.json maps "bun-builtins-table" to it. Where the table is made that
// name is the engine's file itself (generator/load-declaration-files.ts), so a word that the list lacks works in every build and is an error of tsc alone, which no test run showed.
import { expect, test } from "bun:test";
import * as handedOn from "../../../src/codegen/builtins/lib.ts";
import { engineFile } from "../../../src/codegen/engine-directory.ts";

test("every word of the engine's file is handed on", async () => {
  const engine = await import(engineFile("builtins/generator/lib.ts"));
  expect(Object.keys(engine).filter(word => !(word in handedOn))).toEqual([]);
});
