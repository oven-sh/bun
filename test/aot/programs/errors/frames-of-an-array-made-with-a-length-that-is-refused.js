// Prints the frames and call sites of the RangeError for a length that is refused, for each way to spell the call of Array: written Array(n) and new Array(n) the array is made in the caller.
"use strict";
const framesOf = error => error.stack.split("\n").slice(1).map(line => /at (?:new )?(\S+)/.exec(line)?.[1]).filter(name => name && !name.includes("/") && !name.includes(":")).join(" < ");
const sitesOf = run => {
  Error.prepareStackTrace = (error, sites) => sites.slice(0, 3).map(site => site.getFunctionName() + " " + site.getLineNumber() + ":" + site.getColumnNumber() + (site.isNative() ? " native" : "") + (site.isConstructor() ? " constructor" : "")).join(" < ");
  try { run(); } catch (error) { return error.stack; } finally { Error.prepareStackTrace = undefined; }
};
const Other = Array;
let changing = Object; changing = Array;
const forms = {
  writtenConstant() { return Array(-1); },
  writtenConstantNew() { return new Array(-1); },
  writtenUnknown(n) { return Array(n); },
  writtenUnknownNew(n) { return new Array(n); },
  member(n) { return globalThis.Array(n); },
  memberConstant() { return globalThis.Array(-1); },
  memberNew(n) { return new globalThis.Array(n); },
  memberNewConstant() { return new globalThis.Array(-1); },
  otherName(n) { return Other(n); },
  otherNameConstant() { return Other(-1); },
  otherNameNew(n) { return new Other(n); },
  otherNameNewConstant() { return new Other(-1); },
  changingName(n) { return changing(n); },
  changingNameNew(n) { return new changing(n); },
  localNamedArray(n) { const Array = globalThis.Array; String(Array); return Array(n); },
  parameterNamedArray(n, Array = globalThis.Array) { return Array(n); },
  parenthesized(n) { return (Array)(n); },
  optional(n) { return Array?.(n); },
  spread(n) { return Array(...[n]); },
  call(n) { return Array.call(undefined, n); },
  apply(n) { return Array.apply(undefined, [n]); },
  reflectApply(n) { return Reflect.apply(Array, undefined, [n]); },
  reflectConstruct(n) { return Reflect.construct(Array, [n]); },
  notInTailPosition(n) { const list = Array(n); return list; },
  notInTailPositionNew(n) { const list = new Array(n); return list; },
  inATry(n) { try { return Array(n); } finally { String(n); } },
  twoArguments(n) { return Array(n, { get length() { return 1; } }).length; },
};
for (const [name, form] of Object.entries(forms)) {
  for (const n of [-1, 1.5]) {
    try { console.log(name, n, form(n)); } catch (error) { console.log(name, n, error.constructor.name, "|", framesOf(error), "|", sitesOf(() => form(n))); }
  }
}
