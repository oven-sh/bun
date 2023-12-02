// Not working yet, WIP

import { callerSourceOrigin } from "bun:jsc";

type EventEmitter = import("node:events").EventEmitter;
type Expect = (value: unknown) => import("bun:test").Expect;
type Fn = () => unknown;
type Future = Promise<unknown> | (() => Promise<unknown>);
type Extra = {
  [key: string | number | symbol]: unknown;
  todo?: boolean | string;
  skip?: boolean | string;
};

export function test(name: string, options?: Extra, fn?: (t: Tap) => unknown): Promise<void> {
  // @ts-expect-error
  const { expect } = Bun.jest(callerSourceOrigin());
  const tap = new Tap({
    expect: expect,
    name,
    context: {},
    parent: null,
    before: [],
    after: [],
  });
  return tap.test(name, options, fn);
}

/**
 * @link https://node-tap.org/docs/api/
 */
class Tap {
  #_expect: Expect;

  #name: string;
  #context: unknown;

  #parent: Tap | null;
  #children: Tap[];

  #before: Fn[];
  #beforeEach: Fn[];
  #after: Fn[];
  #afterEach: Fn[];

  #abort: AbortController;
  #aborted: Promise<void>;
  #timeout: number | null;
  #passing: boolean;
  #plan: number | null;
  #count: number;

  constructor({
    name,
    context,
    parent,
    before,
    after,
    expect,
  }: {
    name?: string;
    context?: unknown;
    parent?: Tap | null;
    before?: Fn[];
    after?: Fn[];
    expect: Expect;
  }) {
    this.#_expect = expect;
    this.#name = name ?? "";
    this.#context = context ?? {};
    this.#parent = parent ?? null;
    this.#children = [];
    this.#before = before ? [...before] : [];
    this.#beforeEach = [];
    this.#after = after ? [...after] : [];
    this.#afterEach = [];
    this.#abort = new AbortController();
    this.#aborted = new Promise(resolve => {
      this.#abort.signal.addEventListener("abort", () => resolve());
    });
    this.#timeout = null;
    this.#passing = true;
    this.#plan = null;
    this.#count = 0;
  }

  get name(): string {
    return this.#name;
  }

  get context(): unknown {
    return this.#context;
  }

  set context(value: unknown) {
    this.#context = value;
  }

  get passing(): boolean {
    return this.#passing;
  }

  #expect(value: unknown) {
    this.#count++;
    return this.#_expect(value);
  }

  async test(name: string, options?: Extra, fn?: (t: Tap) => unknown): Promise<void> {
    if (typeof options === "function") {
      fn = options;
      options = {};
    }
    if (fn === undefined) {
      throw new Error("Missing test function");
    }
    const test = new Tap({
      expect: this.#_expect,
      name,
      context: this.#context,
      parent: this,
      before: [...this.#before, ...this.#beforeEach],
      after: [...this.#after, ...this.#afterEach],
    });
    this.#children.push(test);
    try {
      for (const fn of this.#before) {
        fn();
      }
      await fn(test);
    } catch (error) {
      test.#passing = false;
      test.#abort.abort(error);
    }
  }

  async todo(name: string, options?: Extra, fn?: (t: Tap) => unknown): Promise<void> {
    console.warn("TODO", name);
  }

  async skip(name: string, options?: Extra, fn?: (t: Tap) => unknown): Promise<void> {
    console.warn("SKIP", name);
  }

  beforeEach(fn: Fn): void {
    this.#beforeEach.push(fn);
  }

  afterEach(fn: Fn): void {
    this.#afterEach.push(fn);
  }

  before(fn: Fn): void {
    this.#before.push(fn);
  }

  teardown(fn: Fn): void {
    this.#after.push(fn);
  }

  setTimeout(timeout: number): void {
    if (timeout === 0) {
      if (this.#timeout !== null) {
        clearTimeout(this.#timeout);
      }
    } else {
      const fn = () => {
        this.#abort.abort(new Error("Timed out"));
      };
      this.#timeout = +setTimeout(fn, timeout);
    }
  }

  pragma(options: Record<string, unknown>): void {
    throw new TODO("pragma");
  }

  plan(count: number, comment?: string): void {
    if (this.#plan !== null) {
      throw new Error("Plan already set");
    }
    this.#plan = count;
  }

  pass(message?: string, extra?: Extra): void {
    // TODO
  }

  fail(message?: string, extra?: Extra): void {
    // TODO
  }

  end(): void {
    if (this.#abort.signal.aborted) {
      throw new Error("Test already ended");
    }
    this.#abort.abort();
  }

  endAll(): void {
    for (const child of this.#children) {
      child.endAll();
    }
    this.end();
  }

  autoend(value: boolean): void {
    throw new TODO("autoend");
  }

  bailout(reason?: string): void {
    throw new TODO("bailout");
  }

  ok(value: unknown, message?: string, extra?: Extra): void {
    this.#expect(value).toBeTruthy();
  }

  notOk(value: unknown, message?: string, extra?: Extra): void {
    this.#expect(value).toBeFalsy();
  }

  error(value: unknown, message?: string, extra?: Extra): void {
    this.#expect(value).toBeInstanceOf(Error);
  }

  async emits(eventEmitter: EventEmitter, event: string, message?: string, extra?: Extra): Promise<void> {
    throw new TODO("emits");
  }

  async rejects(value: Future, expectedError?: Error, message?: string, extra?: Extra): Promise<void> {
    throw new TODO("rejects");
  }

  async resolves(value: Future, message?: string, extra?: Extra): Promise<void> {
    throw new TODO("resolves");
  }

  async resolveMatch(value: Future, expected: unknown, message?: string, extra?: Extra): Promise<void> {
    throw new TODO("resolveMatch");
  }

  async resolveMatchSnapshot(value: Future, message?: string, extra?: Extra): Promise<void> {
    throw new TODO("resolveMatchSnapshot");
  }

  throws(fn: Fn, expectedError?: Error, message?: string, extra?: Extra): void {
    this.#expect(fn).toThrow(expectedError);
  }

  doesNotThrow(fn: Fn, message?: string, extra?: Extra): void {
    throw new TODO("doesNotThrow");
  }

  expectUncaughtException(expectedError?: Error, message?: string, extra?: Extra): void {
    throw new TODO("expectUncaughtException");
  }

  equal(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    this.#expect(actual).toBe(expected);
  }

  not(expected: unknown, actual: unknown, message?: string, extra?: Extra): void {
    this.#expect(actual).not.toBe(expected);
  }

  same(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    this.#expect(actual).toEqual(expected);
  }

  notSame(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    this.#expect(actual).not.toEqual(expected);
  }

  strictSame(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    this.#expect(actual).toStrictEqual(expected);
  }

  strictNotSame(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    this.#expect(actual).not.toStrictEqual(expected);
  }

  hasStrict(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("hasStrict");
  }

  notHasStrict(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("notHasStrict");
  }

  has(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("has");
  }

  notHas(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("notHas");
  }

  hasProp(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("hasProp");
  }

  hasProps(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("hasProps");
  }

  hasOwnProp(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("hasOwnProp");
  }

  hasOwnProps(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("hasOwnProps");
  }

  match(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("match");
  }

  notMatch(actual: unknown, expected: unknown, message?: string, extra?: Extra): void {
    throw new TODO("notMatch");
  }

  type(actual: unknown, type: string, message?: string, extra?: Extra): void {
    const types = ["string", "number", "boolean", "object", "function", "undefined", "symbol", "bigint"];
    if (type in types) {
      return this.#expect(typeof actual).toBe(type);
    }
    this.#expect(actual?.constructor?.name).toBe(type);
  }
}

class TODO extends Error {
  constructor(message?: string) {
    super(message);
  }
}
