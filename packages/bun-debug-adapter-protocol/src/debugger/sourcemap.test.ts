import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SourceMap } from "./sourcemap.js";

test("works without source map", () => {
  const sourceMap = getSourceMap("without-sourcemap.js");
  expect(sourceMap.generatedLocation({ line: 7 })).toEqual({ line: 7, column: 0, verified: true });
  expect(sourceMap.generatedLocation({ line: 7, column: 2 })).toEqual({ line: 7, column: 2, verified: true });
  expect(sourceMap.originalLocation({ line: 11 })).toEqual({ line: 11, column: 0, verified: true });
  expect(sourceMap.originalLocation({ line: 11, column: 2 })).toEqual({ line: 11, column: 2, verified: true });
});

test("works with source map", () => {
  const sourceMap = getSourceMap("with-sourcemap.js");
  // FIXME: Columns don't appear to be accurate for `generatedLocation`
  expect(sourceMap.generatedLocation({ line: 3 })).toMatchObject({ line: 4, verified: true });
  expect(sourceMap.generatedLocation({ line: 27 })).toMatchObject({ line: 20, verified: true });
  expect(sourceMap.originalLocation({ line: 32 })).toEqual({ line: 43, column: 4, verified: true });
  expect(sourceMap.originalLocation({ line: 13 })).toEqual({ line: 13, column: 6, verified: true });
});

function getSourceMap(filename: string): SourceMap {
  const { pathname } = new URL(`./fixtures/${filename}`, import.meta.url);
  const source = readFileSync(pathname, "utf-8");
  const match = source.match(/\/\/# sourceMappingURL=(.*)$/m);
  if (match) {
    const [, url] = match;
    return SourceMap(url);
  }
  return SourceMap();
}
