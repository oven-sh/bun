// RUN: link

// `bun run` runs a file of code once more for an import under a `type`, also where the type says what the name of the file says already.

// FILE: main.mjs
import { made } from "./one.ts";
import { made as again } from "./one.ts" with { type: "ts" };
import { made as third } from "./two.mjs" with { type: "js" };
import { made as fourth } from "./two.mjs";
console.log(made === again, third === fourth);

// FILE: one.ts
export const made = {};

// FILE: two.mjs
export const made = {};

// CHECK: module {{*}}one.ts" displayPath
// CHECK: module {{*}}one.ts?ts" displayPath
// CHECK: module {{*}}two.mjs?js" displayPath
// CHECK: module {{*}}two.mjs" displayPath
