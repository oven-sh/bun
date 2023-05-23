// Hardcoded module "node:assert/strict"
import { strict as strictBase } from "node:assert";

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
