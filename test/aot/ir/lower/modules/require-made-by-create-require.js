// RUN(HELD): lower
// HELD-LABEL: function {{*}}name="held"
// HELD-NOT: = Call
// HELD: = RequireModule module=m{{*}}specifier="node:os"
// HELD: Return

// RUN(FILE): lower
// FILE-LABEL: function {{*}}name="file"
// FILE-NOT: = Call
// FILE-NOT: RequireModule
// FILE: EvaluateModule module=m
// FILE: = GetModuleVariable
// FILE: Return

// RUN(ATONCE): lower
// ATONCE-LABEL: function {{*}}name="atOnce"
// ATONCE: = Call
// ATONCE: = RequireModule module=m{{*}}specifier="node:os"
// ATONCE-NOT: = Call
// ATONCE: Return

// RUN(ELSEWHERE): lower
// ELSEWHERE-LABEL: function {{*}}name="elsewhere"
// ELSEWHERE-NOT: RequireModule
// ELSEWHERE: = Call
// ELSEWHERE: Return

// RUN(STORED): lower
// STORED-LABEL: function {{*}}name="stored"
// STORED-NOT: RequireModule
// STORED: = Call
// STORED: Return

import { createRequire } from "node:module";

const load = createRequire(import.meta.url);
const other = createRequire(process.cwd() + "/");
let changing = createRequire(import.meta.url);
changing = other;

export function held() {
  return load("node:os");
}

export function file() {
  return load("./imports/common.cjs");
}

export function atOnce() {
  return createRequire(import.meta.url)("node:os");
}

export function elsewhere() {
  return other("node:os");
}

export function stored() {
  return changing("node:os");
}
