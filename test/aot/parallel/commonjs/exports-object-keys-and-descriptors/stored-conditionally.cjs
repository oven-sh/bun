const flag = process.argv.length > 100;
if (flag) exports.never = 1;
else exports.always = 2;
exports.last = flag ? (exports.alsoNever = 3) : 4;
for (const name of ["loop"]) exports.inLoop = name;
for (const name of []) exports.inEmptyLoop = name;
while (flag) exports.inLoopThatNeverRuns = 1;
try {
  exports.beforeThrow = 1;
  null.x;
  exports.afterThrow = 2;
} catch {
  exports.caught = 3;
} finally {
  exports.inFinally = 4;
}
flag && (exports.behindAnd = 1);
flag || (exports.behindOr = 2);
(flag ? 0 : null) ?? (exports.behindNullish = 3);
exports.absentAnd &&= 1;
exports.absentOr ||= 2;
exports.absentNullish ??= 3;
exports.always &&= "stored by &&=";
exports.always ||= "not stored by ||=";
switch (flag ? "a" : "b") {
  case "a":
    exports.caseA = 1;
  case "b":
    exports.caseB = 2;
  case "c":
    exports.caseC = 3;
    break;
  default:
    exports.caseDefault = 4;
}
skipped: {
  if (!flag) break skipped;
  exports.afterBreak = 1;
}

if (flag) Object.defineProperty(exports, "definedOrStored", { value: "defined" });
else exports.definedOrStored = "stored";
if (flag) exports.storedOrDefined = "stored";
else Object.defineProperty(exports, "storedOrDefined", { value: "defined" });
if (flag) Object.defineProperty(exports, "getterOrStored", { enumerable: true, get() { return "getter"; } });
else exports.getterOrStored = "stored";
if (flag) exports.storedOrGetter = "stored";
else Object.defineProperty(exports, "storedOrGetter", { enumerable: true, get() { return "getter"; } });
if (flag) Object.defineProperty(exports, "oneFormOrAnother", { value: "one form", enumerable: true });
else Object.defineProperty(exports, "oneFormOrAnother", { value: "another form", writable: true });
if (flag) Object.defineProperty(exports, "getterOrValue", { configurable: true, get() { return "getter"; } });
else Object.defineProperty(exports, "getterOrValue", { configurable: true, value: "value" });
if (flag) Object.defineProperty(exports, "neverDefined", { value: "defined", enumerable: true });

exports.storedOrDefined = "ignored in sloppy code";
exports.storedOrGetter = "ignored in sloppy code";
exports.oneFormOrAnother = "stored";
exports.deletions = [delete exports.storedOrDefined, delete exports.definedOrStored, delete exports.getterOrValue, delete exports.neverDefined].join();
exports.definedOrStored = "stored again";
exports.getterOrValue = "stored again";

if (!flag) return;
exports.afterReturn = 1;
