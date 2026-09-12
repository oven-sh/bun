// bun:test `test.extend()` fixtures; ScopeFunctions.rs calls in through src/jsc/bindings/BunTestFixtures.cpp.

interface FixtureRecord {
  name: string;
  value: unknown;
  isFn: boolean;
  auto: boolean;
  /** The definition this one replaced; received by a fixture that destructures its own name. */
  parent: FixtureRecord | undefined;
}

interface RunState {
  context: Record<string, unknown>;
  /** Pushed during setup, run in reverse by `teardown`. */
  teardowns: (() => Promise<void>)[];
  resolved: FixtureRecord[];
}

/** Merges the object passed to `.extend()` over the parent registry; same-named fixtures replace their parent. */
export function mergeTestFixtures(parentFixtures: FixtureRecord[] | undefined, newFixtures: unknown) {
  if (!$isObject(newFixtures) || $isJSArray(newFixtures) || $isCallable(newFixtures)) {
    throw new TypeError("test.extend() expects an object where each property is a fixture");
  }

  const merged: FixtureRecord[] = [];
  if (parentFixtures !== undefined) {
    for (let i = 0; i < parentFixtures.length; i++) {
      $arrayPush(merged, parentFixtures[i]);
    }
  }

  const names = Object.keys(newFixtures as object);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let value = (newFixtures as Record<string, unknown>)[name];
    let options: { auto?: unknown; injected?: unknown; scope?: unknown } | undefined;

    // `[value, options]` is only a tuple when the second element carries a known option key (as in vitest).
    if ($isJSArray(value) && (value as unknown[]).length >= 2) {
      const maybeOptions = (value as unknown[])[1];
      if ($isObject(maybeOptions) && !$isJSArray(maybeOptions)) {
        const optionKeys = Object.keys(maybeOptions as object);
        for (let k = 0; k < optionKeys.length; k++) {
          const key = optionKeys[k];
          if (key === "auto" || key === "injected" || key === "scope") {
            options = maybeOptions as typeof options;
            break;
          }
        }
        if (options !== undefined) {
          const scope = options.scope;
          if (scope !== undefined && scope !== "test") {
            throw new TypeError(
              `test.extend() fixture "${name}": scope "${String(scope)}" is not supported. Only "test" scoped fixtures are supported.`,
            );
          }
          if (options.injected) {
            throw new TypeError(`test.extend() fixture "${name}": the "injected" option is not supported`);
          }
          value = (value as unknown[])[0];
        }
      }
    }

    let existingIndex = -1;
    for (let m = 0; m < merged.length; m++) {
      if (merged[m].name === name) {
        existingIndex = m;
        break;
      }
    }
    const parent = existingIndex === -1 ? undefined : merged[existingIndex];
    const record: FixtureRecord = {
      name,
      value,
      isFn: $isCallable(value),
      auto: options !== undefined ? !!options.auto : parent !== undefined && parent.auto,
      parent,
    };
    if (existingIndex === -1) {
      $arrayPush(merged, record);
    } else {
      merged[existingIndex] = record;
    }
  }

  return merged;
}

/** Returns `[run, teardown]` for one scheduled test; the runner schedules `teardown` after the afterEach hooks. */
export function wrapTestFixtureCallback(fixtures: FixtureRecord[], testCallback: Function) {
  function includes<T>(array: T[], value: T): boolean {
    for (let i = 0; i < array.length; i++) {
      if (array[i] === value) return true;
    }
    return false;
  }

  /** Splits at top-level commas, skipping nested `{}`/`[]`/`()` groups. */
  function splitByComma(s: string): string[] {
    const result: string[] = [];
    const stack: string[] = [];
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "{" || c === "[" || c === "(") {
        $arrayPush(stack, c === "{" ? "}" : c === "[" ? "]" : ")");
      } else if (stack.length !== 0 && c === stack[stack.length - 1]) {
        stack.length -= 1;
      } else if (stack.length === 0 && c === ",") {
        const token = s.substring(start, i).trim();
        if (token) $arrayPush(result, token);
        start = i + 1;
      }
    }
    const token = s.substring(start).trim();
    if (token) $arrayPush(result, token);
    return result;
  }

  /** Names destructured by `fn`'s parameter at `paramIndex` (read from its source, as in vitest); null for bound and native functions. */
  function getUsedProps(fn: Function, paramIndex: number): string[] | null {
    let source: string;
    try {
      source = fn.toString();
    } catch {
      return null;
    }
    if (/^function\b[^(]*\([^)]*\)\s*\{\s*\[native code\]\s*\}$/.test(source)) {
      return null;
    }
    const parenIndex = source.indexOf("(");
    if (parenIndex === -1) {
      // `x => ...` cannot destructure
      return [];
    }
    let depth = 1;
    let end = parenIndex + 1;
    while (end < source.length && depth > 0) {
      const c = source[end];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      end++;
    }
    const params = splitByComma(source.substring(parenIndex + 1, end - 1));
    const target = params[paramIndex];
    if (target === undefined) return [];
    if (!(target.startsWith("{") && target.endsWith("}"))) {
      throw new TypeError(
        `In tests using test.extend(), the fixture context parameter must use object destructuring, e.g. ({ myFixture }) => { ... }. Received "${target}".`,
      );
    }
    const props = splitByComma(target.substring(1, target.length - 1));
    const used: string[] = [];
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      if (prop.startsWith("...")) {
        throw new TypeError(`Rest parameters are not supported when destructuring fixtures. Received "${prop}".`);
      }
      // strip renames (`a: b`) and defaults (`a = 1`)
      let name = prop;
      for (let c = 0; c < prop.length; c++) {
        if (prop[c] === ":" || prop[c] === "=") {
          name = prop.substring(0, c);
          break;
        }
      }
      name = name.trim();
      const { length } = name;
      if (
        length >= 2 &&
        ((name.startsWith("'") && name.endsWith("'")) || (name.startsWith('"') && name.endsWith('"')))
      ) {
        name = name.substring(1, length - 1);
      }
      if (name) $arrayPush(used, name);
    }
    return used;
  }

  function findFixture(name: string): FixtureRecord | undefined {
    for (let i = 0; i < fixtures.length; i++) {
      if (fixtures[i].name === name) return fixtures[i];
    }
    return undefined;
  }

  /** Resolves to the value passed to `use()`; the fixture function stays parked in `use()` until teardown releases it. */
  function runFixtureSetup(state: RunState, name: string, setupFn: Function): Promise<unknown> {
    const valueCapability = $newPromiseCapability(Promise);
    let useCalled = false;
    let failedAfterUse = false;
    let errorAfterUse: unknown;

    async function use(value: unknown): Promise<void> {
      if (useCalled) {
        throw new Error(`Fixture "${name}" called use() more than once. Call \`await use(value)\` exactly once.`);
      }
      useCalled = true;
      const release = $newPromiseCapability(Promise);
      $arrayPush(state.teardowns, async () => {
        release.resolve.$call(undefined);
        await finished;
        if (failedAfterUse) throw errorAfterUse;
      });
      valueCapability.resolve.$call(undefined, value);
      await release.promise;
    }

    // Never rejects: a failure after use() is reported by the teardown, one before it by the value promise.
    const finished: Promise<void> = (async () => {
      await setupFn(state.context, use);
    })().$then(
      () => {
        if (!useCalled) {
          valueCapability.reject.$call(
            undefined,
            new Error(
              `Fixture "${name}" completed without calling use(). Call \`await use(value)\` in the fixture function.`,
            ),
          );
        }
      },
      (error: unknown) => {
        if (useCalled) {
          failedAfterUse = true;
          errorAfterUse = error;
        } else {
          valueCapability.reject.$call(undefined, error);
        }
      },
    );

    return valueCapability.promise;
  }

  async function setupFixture(state: RunState, record: FixtureRecord, chain: FixtureRecord[]): Promise<void> {
    if (includes(state.resolved, record)) return;
    const name = record.name;
    if (includes(chain, record)) {
      let path = "";
      for (let i = 0; i < chain.length; i++) {
        path += chain[i].name + " -> ";
      }
      throw new Error(`Circular fixture dependency: ${path}${name}`);
    }
    if (!record.isFn) {
      state.context[name] = record.value;
      $arrayPush(state.resolved, record);
      return;
    }

    const nextChain: FixtureRecord[] = [];
    for (let i = 0; i < chain.length; i++) $arrayPush(nextChain, chain[i]);
    $arrayPush(nextChain, record);

    const deps = getUsedProps(record.value as Function, 0);
    if (deps === null) {
      throw new TypeError(
        `Fixture "${name}" is a bound or native function, so the fixtures it depends on cannot be read from its source. Define it as a function that destructures the fixtures it uses, e.g. ({ db }, use) => { ... }.`,
      );
    }
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i];
      if (dep === name) {
        if (record.parent === undefined) {
          throw new Error(
            `Fixture "${name}" depends on itself, but there is no earlier definition of "${name}" for it to extend.`,
          );
        }
        await setupFixture(state, record.parent, nextChain);
        continue;
      }
      const depRecord = findFixture(dep);
      if (depRecord !== undefined) {
        await setupFixture(state, depRecord, nextChain);
      }
    }

    state.context[name] = await runFixtureSetup(state, name, record.value as Function);
    $arrayPush(state.resolved, record);
  }

  /** Set by `run`, consumed by the `teardown` entry that follows it (also after a timed out body). */
  let active: RunState | null = null;

  async function run(...caseArgs: unknown[]) {
    const state: RunState = { context: { __proto__: null }, teardowns: [], resolved: [] };
    active = state;

    const { length } = fixtures;
    if (length !== 0) {
      // the `.each` row values precede the context parameter; a bound callback (null) gets every fixture
      const used = getUsedProps(testCallback, caseArgs.length);
      for (let i = 0; i < length; i++) {
        const record = fixtures[i];
        if (record.auto || used === null || includes(used, record.name)) {
          await setupFixture(state, record, []);
        }
      }
    }

    await testCallback(...caseArgs, state.context);
  }

  async function teardown() {
    const state = active;
    active = null;
    if (state === null) return;

    const errors: unknown[] = [];
    for (let i = state.teardowns.length - 1; i >= 0; i--) {
      try {
        await state.teardowns[i]();
      } catch (error) {
        $arrayPush(errors, error);
      }
    }
    const failures = errors.length;
    if (failures === 1) throw errors[0];
    if (failures > 1) throw new AggregateError(errors, `${failures} fixture teardowns failed`);
  }

  return [run, teardown];
}
