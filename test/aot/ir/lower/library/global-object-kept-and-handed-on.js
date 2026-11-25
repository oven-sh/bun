// RUN: link
// OPTIONS: builtin-modules
// CHECK: module {{*}}path="bun:sql" {{*}}body=

// The variable goes somewhere as a value.

// FILE: main.js
var _a;
(_a = globalThis).ownRegistry ?? (_a.ownRegistry = {});
export const held = [_a];
