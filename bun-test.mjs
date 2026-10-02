// `bun:test` on top of node:test and node:assert. Only what the http2 test files use.
import assert from "node:assert";
import nodeTest from "node:test";
import { format, isDeepStrictEqual, inspect } from "node:util";

// bun's toEqual ignores properties whose value is undefined.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const key of Object.keys(value)) if (value[key] !== undefined) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

function matchers(received, negate) {
  const check = (pass, message) => {
    if (pass === negate) assert.fail(message());
  };
  return {
    toEqual(expected) {
      const a = normalize(received);
      const b = normalize(expected);
      if (!negate) return assert.deepStrictEqual(a, b);
      check(isDeepStrictEqual(a, b), () => `expected values to differ: ${inspect(a)}`);
    },
    toStrictEqual(expected) {
      if (!negate) return assert.deepStrictEqual(received, expected);
      check(isDeepStrictEqual(received, expected), () => `expected values to differ: ${inspect(received)}`);
    },
    toBe(expected) {
      check(Object.is(received, expected), () => `expected ${inspect(received)} ${negate ? "not " : ""}to be ${inspect(expected)}`);
    },
    toContain(item) {
      check(received.includes(item), () => `expected ${inspect(received)} ${negate ? "not " : ""}to contain ${inspect(item)}`);
    },
    toBeGreaterThan(n) {
      check(received > n, () => `expected ${received} ${negate ? "not " : ""}> ${n}`);
    },
    toBeLessThan(n) {
      check(received < n, () => `expected ${received} ${negate ? "not " : ""}< ${n}`);
    },
    toBeUndefined() {
      check(received === undefined, () => `expected ${inspect(received)} ${negate ? "not " : ""}to be undefined`);
    },
    toHaveLength(n) {
      check(received.length === n, () => `expected length ${received.length} ${negate ? "not " : ""}to be ${n}`);
    },
  };
}

export function expect(received) {
  const m = matchers(received, false);
  m.not = matchers(received, true);
  return m;
}

function title(name, row) {
  const args = Array.isArray(row) ? row : [row];
  const used = (name.match(/%[sdifjoOp]/g) || []).length;
  return format(name.replace(/%p/g, "%o"), ...args.slice(0, used));
}

function wrap(run) {
  const fn = (name, body, timeout) => run(name, typeof timeout === "number" ? { timeout } : {}, body);
  fn.each = table => (name, body, timeout) => {
    for (const row of table) {
      const args = Array.isArray(row) ? row : [row];
      run(title(name, row), typeof timeout === "number" ? { timeout } : {}, () => body(...args));
    }
  };
  return fn;
}

function make(base) {
  const fn = wrap((name, options, body) => base(name, options, body));
  fn.skip = wrap((name, options, body) => base(name, { ...options, skip: true }, body));
  fn.skip.skip = fn.skip;
  fn.todo = fn.skip;
  fn.only = fn;
  fn.concurrent = fn;
  fn.skipIf = cond => (cond ? fn.skip : fn);
  fn.if = cond => (cond ? fn : fn.skip);
  fn.todoIf = cond => (cond ? fn.skip : fn);
  return fn;
}

export const test = make(nodeTest.test);
export const it = test;
export const describe = make(nodeTest.describe);
export const beforeAll = nodeTest.before;
export const afterAll = nodeTest.after;
export const beforeEach = nodeTest.beforeEach;
export const afterEach = nodeTest.afterEach;
