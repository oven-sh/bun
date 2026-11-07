// Which async functions hold an `await` of their own: HasWrittenAwait. The parser of the engine says it of what Bun's transpiler prints, so what that folds away or
// drops behind a `return` does not count, nor does an `await` of a function written inside. The image lists the async functions without the flag.
// RUN: lower

declare const x: Promise<number>;
declare const list: Promise<number>[];
export async function awaits() { await x; }
export async function awaitsInAKey() { return { [await x]: 1 }; }
export async function awaitsWhereNeverReached() { if (list.length > 5) await x; }
export async function awaitsBehindATestOfAType() { if (typeof x === "number") await x; }
export async function forAwait() { for await (const each of list) void each; }
export async function noAwait() {}
export async function wordInAComment() { /* await x */ }
export async function wordInAString() { return "await x"; }
export async function wordInATemplate() { return `await x`; }
export async function wordInARegularExpression() { return /await x/; }
export async function awaitOfAnInnerFunction() { return async function () { await x; }; }
export async function awaitOfAnInnerArrow() { return async () => await x; }
export async function awaitOfAMethod() { return { async inner() { await x; } }; }
export async function awaitOfAMethodOfAClass() { return class { async inner() { await x; } }; }
export async function awaitBehindReturn() { return; await x; }
export async function awaitBehindThrow() { if (list.length > 5) { throw 1; await x; } }
export async function awaitBehindFalse() { false && (await x); }
export async function awaitBehindIfFalse() { if (false) { await x; } }
export async function awaitInTheArmNotTaken() { return true ? 1 : await x; }

// The functions come in the order of their names.
// CHECK: function {{*}}name="awaitBehindFalse"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitBehindIfFalse"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitBehindReturn"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitBehindThrow"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitInTheArmNotTaken"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitOfAMethod"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitOfAMethodOfAClass"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitOfAnInnerArrow"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaitOfAnInnerFunction"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="awaits"{{*}}HasExplicitName] syntax=[HasWrittenAwait] thisType=
// CHECK: function {{*}}name="awaitsBehindATestOfAType"{{*}}HasExplicitName] syntax=[HasWrittenAwait] thisType=
// CHECK: function {{*}}name="awaitsInAKey"{{*}}HasExplicitName] syntax=[HasWrittenAwait] thisType=
// CHECK: function {{*}}name="awaitsWhereNeverReached"{{*}}HasExplicitName] syntax=[HasWrittenAwait] thisType=
// CHECK: function {{*}}name="forAwait"{{*}}HasExplicitName] syntax=[HasWrittenAwait] thisType=
// CHECK: function {{*}}name="noAwait"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="wordInAComment"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="wordInARegularExpression"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="wordInAString"{{*}}HasExplicitName] thisType=
// CHECK: function {{*}}name="wordInATemplate"{{*}}HasExplicitName] thisType=
