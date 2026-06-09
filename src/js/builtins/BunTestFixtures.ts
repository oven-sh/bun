// Fixture support for bun:test's `test.extend()` (modeled on vitest/playwright fixtures).
//
// A fixture registry is an array of records `{ name, value, isFn, auto }` built by
// `mergeTestFixtures` when `.extend()` is called, and consumed by
// `wrapTestFixtureCallback` each time a test registered through an extended test
// function runs. Both functions are invoked from native code
// (src/runtime/test_runner/ScopeFunctions.rs via Bun__TestFixtures__* in
// src/jsc/bindings/BunTestFixtures.cpp).

interface FixtureRecord {
  name: string;
  value: unknown;
  isFn: boolean;
  auto: boolean;
}

/**
 * Validate the object passed to `test.extend()` and merge it over the parent
 * registry (later `.extend()` calls override earlier fixtures with the same name).
 */
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
    let auto = false;

    // `[value, options]` tuple form. Mirrors vitest: only treated as a tuple when the
    // second element is an object carrying at least one known fixture option key;
    // otherwise the array itself is the fixture value.
    if ($isJSArray(value) && (value as unknown[]).length >= 2) {
      const maybeOptions = (value as unknown[])[1];
      if ($isObject(maybeOptions) && !$isJSArray(maybeOptions)) {
        const optionKeys = Object.keys(maybeOptions as object);
        let isOptions = false;
        for (let k = 0; k < optionKeys.length; k++) {
          const key = optionKeys[k];
          if (key === "auto" || key === "injected" || key === "scope") {
            isOptions = true;
            break;
          }
        }
        if (isOptions) {
          const options = maybeOptions as { auto?: unknown; injected?: unknown; scope?: unknown };
          const scope = options.scope;
          if (scope !== undefined && scope !== "test") {
            throw new TypeError(
              `test.extend() fixture "${name}": scope "${String(scope)}" is not supported. Only "test" scoped fixtures are supported.`,
            );
          }
          if (options.injected) {
            throw new TypeError(`test.extend() fixture "${name}": the "injected" option is not supported`);
          }
          auto = !!options.auto;
          value = (value as unknown[])[0];
        }
      }
    }

    const record: FixtureRecord = { name, value, isFn: $isCallable(value), auto };
    let replaced = false;
    for (let m = 0; m < merged.length; m++) {
      if (merged[m].name === name) {
        merged[m] = record;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      $arrayPush(merged, record);
    }
  }

  return merged;
}

/**
 * Wrap a test callback so that, when the test runs, the fixtures it uses are set
 * up first (in dependency order), the callback receives the fixture context as
 * its last argument (after any `test.each` case arguments), and teardown runs in
 * reverse setup order once the callback settles.
 */
export function wrapTestFixtureCallback(fixtures: FixtureRecord[], testCallback: Function) {
  function arrayIncludes(array: string[], value: string): boolean {
    for (let i = 0; i < array.length; i++) {
      if (array[i] === value) return true;
    }
    return false;
  }

  // Split a parameter list (or destructuring pattern body) at top-level commas,
  // skipping over nested `{}`/`[]`/`()` groups.
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

  // Determine which fixture names a function destructures from its context
  // parameter (the parameter at `paramIndex`). Like vitest, this reads the
  // function's source text, so the context parameter must use an object
  // destructuring pattern for fixtures to be detected. Returns null when the
  // source is unavailable (bound functions, AsyncLocalStorage-wrapped
  // callbacks), in which case the caller decides a fallback.
  function getUsedProps(fn: Function, paramIndex: number): string[] | null {
    let source: string;
    try {
      source = fn.toString();
    } catch {
      return null;
    }
    if (source.indexOf("[native code]") !== -1) {
      return null;
    }
    const parenIndex = source.indexOf("(");
    if (parenIndex === -1) {
      // single-parameter arrow function with no parentheses; it cannot
      // destructure, so it uses no fixtures.
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
      // strip renames (`a: b`) and default values (`a = 1`)
      let name = prop;
      for (let c = 0; c < prop.length; c++) {
        if (prop[c] === ":" || prop[c] === "=") {
          name = prop.substring(0, c);
          break;
        }
      }
      name = name.trim();
      if (
        name.length >= 2 &&
        ((name.startsWith("'") && name.endsWith("'")) || (name.startsWith('"') && name.endsWith('"')))
      ) {
        name = name.substring(1, name.length - 1);
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

  return async function (...caseArgs: unknown[]) {
    const context: Record<string, unknown> = {};
    if (fixtures.length === 0) {
      return testCallback(...caseArgs, context);
    }

    const teardowns: (() => Promise<unknown>)[] = [];
    const resolvedNames: string[] = [];

    // Run one fixture function. The value passed to `use()` becomes the fixture
    // value; the fixture function then stays suspended inside `use()` until
    // teardown, when the remainder of the fixture function runs.
    function runFixtureSetup(name: string, setupFn: Function): Promise<unknown> {
      const valueCapability = $newPromiseCapability(Promise);
      let useCalled = false;
      // assigned before any teardown can run; teardown closures only execute
      // after the test body, long after this synchronous assignment
      let fixtureReturn: Promise<void>;
      fixtureReturn = (async () => {
        await setupFn(context, async (useValue: unknown) => {
          useCalled = true;
          valueCapability.resolve.$call(undefined, useValue);
          const releaseCapability = $newPromiseCapability(Promise);
          $arrayPush(teardowns, () => {
            releaseCapability.resolve.$call(undefined);
            return fixtureReturn;
          });
          await releaseCapability.promise;
        });
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
          if (!useCalled) {
            // setup failed; surface the error where the fixture value is awaited
            valueCapability.reject.$call(undefined, error);
            return;
          }
          // teardown failed; surface the error when teardown awaits fixtureReturn
          throw error;
        },
      );
      return valueCapability.promise;
    }

    async function setupFixture(record: FixtureRecord, chain: string[]): Promise<void> {
      const name = record.name;
      if (arrayIncludes(resolvedNames, name)) return;
      if (arrayIncludes(chain, name)) {
        let path = "";
        for (let i = 0; i < chain.length; i++) {
          path += chain[i] + " -> ";
        }
        throw new Error(`Circular fixture dependency: ${path}${name}`);
      }
      if (!record.isFn) {
        context[name] = record.value;
        $arrayPush(resolvedNames, name);
        return;
      }
      // a fixture function whose source is unavailable has no detectable
      // dependencies; treat it as depending on nothing
      const deps = getUsedProps(record.value as Function, 0) ?? [];
      for (let i = 0; i < deps.length; i++) {
        const dep = deps[i];
        if (dep === name) continue;
        const depRecord = findFixture(dep);
        if (depRecord === undefined) continue;
        const nextChain: string[] = [];
        for (let c = 0; c < chain.length; c++) $arrayPush(nextChain, chain[c]);
        $arrayPush(nextChain, name);
        await setupFixture(depRecord, nextChain);
      }
      context[name] = await runFixtureSetup(name, record.value as Function);
      $arrayPush(resolvedNames, name);
    }

    let bodyError: unknown;
    let hasBodyError = false;
    try {
      // `test.each` case arguments are bound before the context parameter, so the
      // destructuring pattern to analyze is the parameter after them. When the
      // callback's source is unavailable, set up every fixture.
      const used = getUsedProps(testCallback, caseArgs.length);
      for (let i = 0; i < fixtures.length; i++) {
        const record = fixtures[i];
        if (record.auto || used === null || arrayIncludes(used, record.name)) {
          await setupFixture(record, []);
        }
      }
      await testCallback(...caseArgs, context);
    } catch (error) {
      hasBodyError = true;
      bodyError = error;
    }

    // Teardown in reverse setup order. Always run every teardown, even when the
    // test body or an earlier teardown failed.
    const teardownErrors: unknown[] = [];
    for (let i = teardowns.length - 1; i >= 0; i--) {
      try {
        await teardowns[i]();
      } catch (error) {
        $arrayPush(teardownErrors, error);
      }
    }

    if (hasBodyError) throw bodyError;
    if (teardownErrors.length === 1) throw teardownErrors[0];
    if (teardownErrors.length > 1) throw new AggregateError(teardownErrors, "fixture teardown failed");
  };
}
