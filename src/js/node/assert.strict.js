// @module "node:assert/strict"
var { strict: strictBase } = import.meta.require("node:assert");

export var {
  fail,
  AssertionError,
  ok,
  equal,
  notEqual,
  deepEqual,
  notDeepEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  strictEqual,
  notStrictEqual,
  throws,
  rejects,
  doesNotThrow,
  doesNotReject,
  ifError,
  match,
  doesNotMatch,
  CallTracker,
} = strictBase;

const defaultObject = {
  fail,
  AssertionError,
  ok,
  equal,
  notEqual,
  deepEqual,
  notDeepEqual,
  deepStrictEqual,
  notDeepStrictEqual,
  strictEqual,
  notStrictEqual,
  throws,
  rejects,
  doesNotThrow,
  doesNotReject,
  ifError,
  match,
  doesNotMatch,
  CallTracker,
  [Symbol.for("CommonJS")]: 0,
};

export { defaultObject as default, strictBase as strict };
