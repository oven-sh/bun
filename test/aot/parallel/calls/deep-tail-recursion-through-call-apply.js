// Recursion 300,000 calls deep where each call goes through call, apply or Reflect.apply of a function nobody knows: the call they pass on is a tail call.
"use strict";
function attempt(name, run) {
  try {
    console.log(name + ": " + run());
  } catch (error) {
    console.log(name + ": " + error.constructor.name);
  }
}
const unknown = value => [value][0];
const depth = 300000;

function throughCall(n, total) {
  if (n === 0) return total;
  return unknown(throughCall).call(undefined, n - 1, total + n);
}
function throughCallWithManyArguments(n, a, b, c, d, e, f, g, h, i) {
  if (n === 0) return a + b + c + d + e + f + g + h + i;
  return unknown(throughCallWithManyArguments).call(undefined, n - 1, a + 1, b, c, d, e, f, g, h, i);
}
function throughCallWithoutArguments() {
  if (--remaining === 0) return "done";
  return unknown(throughCallWithoutArguments).call();
}
function throughApply(n, total) {
  if (n === 0) return total;
  return unknown(throughApply).apply(undefined, [n - 1, total + n]);
}
function throughApplyOfUnknownList(n, total) {
  if (n === 0) return total;
  return unknown(throughApplyOfUnknownList).apply(undefined, unknown([n - 1, total + n]));
}
function throughApplyOfArrayLike(n, total) {
  if (n === 0) return total;
  return unknown(throughApplyOfArrayLike).apply(undefined, unknown({ length: 2, 0: n - 1, 1: total + n }));
}
function throughApplyOfArguments(n, total) {
  if (n === 0) return total;
  arguments[0] = n - 1;
  arguments[1] = total + n;
  return unknown(throughApplyOfArguments).apply(undefined, arguments);
}
function throughApplyWithoutList() {
  if (--remaining === 0) return "done";
  return unknown(throughApplyWithoutList).apply(undefined, unknown(remaining % 2 ? undefined : null));
}
function throughReflectApply(n, total) {
  if (n === 0) return total;
  return Reflect.apply(unknown(throughReflectApply), undefined, [n - 1, total + n]);
}
function throughReflectApplyOfArrayLike(n, total) {
  if (n === 0) return total;
  return Reflect.apply(unknown(throughReflectApplyOfArrayLike), undefined, unknown({ length: 2, 0: n - 1, 1: total + n }));
}
function throughCallOfApply(n, total) {
  if (n === 0) return total;
  return Function.prototype.apply.call(unknown(throughCallOfApply), undefined, [n - 1, total + n]);
}

let remaining = 0;
attempt("call", () => throughCall(depth, 0));
attempt("call with ten arguments", () => throughCallWithManyArguments(depth, 1, 2, 3, 4, 5, 6, 7, 8, 9));
attempt("call without arguments", () => ((remaining = depth), throughCallWithoutArguments()));
attempt("apply", () => throughApply(depth, 0));
attempt("apply of an unknown list", () => throughApplyOfUnknownList(depth, 0));
attempt("apply of an array-like object", () => throughApplyOfArrayLike(depth, 0));
attempt("apply of arguments", () => throughApplyOfArguments(depth, 0));
attempt("apply without a list", () => ((remaining = depth), throughApplyWithoutList()));
attempt("Reflect.apply", () => throughReflectApply(depth, 0));
attempt("Reflect.apply of an array-like object", () => throughReflectApplyOfArrayLike(depth, 0));
attempt("call of apply", () => throughCallOfApply(depth, 0));
