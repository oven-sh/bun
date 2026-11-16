// `.indexOf`, `.slice` and `.length` fit a string and an Array alike, so the code alone does not say what `text` is. The declaration file does.
// `cut` is not exported and only ever called by its name: it is given what `count` is given.
// RUN: link
// CHECK: function {{*}}name="count" {{*}}parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}]
// CHECK: function {{*}}name="cut" {{*}}parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}]

// FILE: main.mjs
import { count } from "texts";
console.log(count(JSON.parse(process.argv[2]), ","));

// FILE: node_modules/texts/package.json
{"name": "texts", "version": "1.0.0", "type": "module", "main": "index.js", "types": "index.d.ts"}

// FILE: node_modules/texts/index.js
export function count(text, mark) {
  let found = 0;
  for (let at = text.indexOf(mark); at !== -1; at = text.indexOf(mark, at + 1)) found += cut(text, at).length;
  return found + text.length;
}
function cut(whole, end) {
  return whole.slice(0, end);
}

// FILE: node_modules/texts/index.d.ts
export declare function count(text: string, mark: string): number;
