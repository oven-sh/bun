// createRequire(path.join(import.meta.dirname, "vendor", "start.cjs")): the build reads the path out of what is written and binds the loads through the require to its folder.
// path.join is an ordinary member that a program may store to, so the value that createRequire() was given is held against the written path, as the name of a load is.
// Another value throws nothing: the require is noted, and a load through a noted require is the call as written.
// RUN(JOINED): lower
// JOINED-LABEL: function {{*}}name="joined"
// JOINED: [[made]] = Call {{*}}calleeName="createRequire"
// JOINED: = String string="/vendor/start.cjs"
// JOINED: = StrictEq
// JOINED: = Builtin builtin=WeakSetPrototypeAdd
// JOINED-NEXT: = Call {{*}}, {{*}}, [[made]]
// JOINED: = Builtin builtin=WeakSetPrototypeHas
// JOINED-NEXT: = Call {{*}}, {{*}}, [[made]]
// JOINED: EvaluateModule
// JOINED-NOT: Throw
// JOINED: = Call [[made]], -,
// Nothing can change what a sum of texts gives: no question, and the load asks nothing.
// RUN(SUM): lower
// SUM-LABEL: function {{*}}name="summed"
// SUM-NOT: WeakSet
// SUM: Return

// FILE: main.mjs
import { createRequire } from "node:module";
import path from "node:path";
export const joined = () => createRequire(path.join(import.meta.dirname, "vendor", "start.cjs"))("./part.cjs");
export const summed = () => createRequire(import.meta.dirname + "/vendor/start.cjs")("./part.cjs");

// FILE: vendor/part.cjs
exports.said = "part";
