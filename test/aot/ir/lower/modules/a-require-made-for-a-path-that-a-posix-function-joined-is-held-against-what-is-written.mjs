// createRequire(join(import.meta.dirname, "vendor", "start.cjs")) with the functions of node:path/posix or of path.posix. They are path's own everywhere but on Windows, so the
// build reads the path as it reads one that path.join() joined, and binds the loads through the require to its folder.
// The value that createRequire() was given is held against the written path, as for path.join(). Another value throws nothing: the require is noted, and a load through a noted
// require is the call as written.
// RUN(POSIX): lower
// POSIX-LABEL: function {{*}}name="joined"
// POSIX: [[made]] = Call {{*}}calleeName="createRequire"
// POSIX: = String string="/vendor/start.cjs"
// POSIX: = StrictEq
// POSIX: = Builtin builtin=WeakSetPrototypeAdd
// POSIX-NEXT: = Call {{*}}, {{*}}, [[made]]
// POSIX: = Builtin builtin=WeakSetPrototypeHas
// POSIX-NEXT: = Call {{*}}, {{*}}, [[made]]
// POSIX: EvaluateModule
// POSIX-NOT: Throw
// POSIX: = Call [[made]], -,
// POSIX-LABEL: function {{*}}name="member"
// POSIX: [[ofMember]] = Call {{*}}calleeName="createRequire"
// POSIX: = String string="/vendor/start.cjs"
// POSIX: = StrictEq
// POSIX: = Builtin builtin=WeakSetPrototypeAdd
// POSIX-NEXT: = Call {{*}}, {{*}}, [[ofMember]]
// POSIX: EvaluateModule
// POSIX-NOT: Throw
// POSIX-LABEL: function {{*}}name="named"
// POSIX: [[ofNamed]] = Call {{*}}calleeName="createRequire"
// POSIX: = String string="/vendor/start.cjs"
// POSIX: = StrictEq
// POSIX: = Builtin builtin=WeakSetPrototypeAdd
// POSIX-NEXT: = Call {{*}}, {{*}}, [[ofNamed]]
// POSIX: EvaluateModule
// POSIX-NOT: Throw
// POSIX-LABEL: function {{*}}name="resolved"
// POSIX: [[ofResolved]] = Call {{*}}calleeName="createRequire"
// POSIX: = String string="/vendor/"
// POSIX: = StrictEq
// POSIX: = Builtin builtin=WeakSetPrototypeAdd
// POSIX-NEXT: = Call {{*}}, {{*}}, [[ofResolved]]
// POSIX: EvaluateModule
// POSIX-NOT: Throw
// On Windows path.posix.join() leaves the native folder as it is and puts "/" behind it: the value is also held against the written path with every "/" turned.
// RUN(WINDOWS): lower
// OPTIONS(WINDOWS): platform=windows
// WINDOWS-LABEL: function {{*}}name="joined"
// WINDOWS: [[given]] = Call {{*}}calleeName="join"
// WINDOWS: [[made]] = Call {{*}}calleeName="createRequire"
// WINDOWS: = String string="\\vendor\\start.cjs"
// WINDOWS: [[written]] = Strcat
// WINDOWS-NEXT: = StrictEq [[given]], [[written]]
// WINDOWS: [[replaceAll]] = Builtin builtin=StringPrototypeReplaceAll
// WINDOWS-NEXT: [[slash]] = String string="/"
// WINDOWS-NEXT: [[backslash]] = String string="\\"
// WINDOWS-NEXT: [[turned]] = Call [[replaceAll]], [[given]], [[slash]], [[backslash]]
// WINDOWS-NEXT: = StrictEq [[turned]], [[written]]
// WINDOWS: = Builtin builtin=WeakSetPrototypeAdd
// WINDOWS-NEXT: = Call {{*}}, {{*}}, [[made]]
// WINDOWS: EvaluateModule

// FILE: main.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { dirname, join, resolve } from "node:path/posix";
export const joined = () => createRequire(join(import.meta.dirname, "vendor", "start.cjs"))("./part.cjs");
export const member = () => createRequire(path.posix.join(import.meta.dirname, "vendor", "start.cjs"))("./part.cjs");
export const named = () => createRequire(join(dirname(import.meta.filename), "vendor", "start.cjs"))("./part.cjs");
export const resolved = () => createRequire(resolve(import.meta.dirname, "vendor") + "/")("./part.cjs");

// FILE: vendor/part.cjs
exports.said = "part";
