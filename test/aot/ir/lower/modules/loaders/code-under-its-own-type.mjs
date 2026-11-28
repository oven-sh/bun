// RUN: link

// A `type` that says what the name of the file says already asks for the module that an import without it gets.

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

// CHECK-NOT: one.ts?ts
// CHECK: module {{*}}one.ts" displayPath
// CHECK-NOT: one.ts?ts
// CHECK-NOT: two.mjs?js
// CHECK: module {{*}}two.mjs" displayPath
// CHECK-NOT: two.mjs?js
