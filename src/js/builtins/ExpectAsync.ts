// `expect(promise).resolves` / `.rejects` return a Proxy whose matcher calls run once the
// promise settles and return a Promise, as in Jest. Nothing here blocks the event loop.
export function createAsyncMatcher(expectFn, value, isRejects: boolean, isNot: boolean, label) {
  const kind = isRejects ? "rejects" : "resolves";

  function isError(candidate) {
    return candidate instanceof Error || Object.prototype.toString.$call(candidate) === "[object Error]";
  }

  function describe(received) {
    try {
      return Bun.inspect(received);
    } catch {
      return String(received);
    }
  }

  // Jest prints a custom label as the first line of every failure, including the
  // ones raised before the matcher itself runs.
  function withLabel(message: string) {
    return label === undefined ? message : `${label}\n\n${message}`;
  }

  async function run(name: string, args: unknown[], negated: boolean) {
    if (
      value === null ||
      (typeof value !== "object" && typeof value !== "function") ||
      typeof value.then !== "function"
    ) {
      throw new Error(
        withLabel(
          `expect(received).${kind}.${name}()\n\nMatcher error: received value must be a promise or a function returning a promise\nReceived: ${describe(value)}`,
        ),
      );
    }
    let settled;
    let fulfilled = true;
    try {
      settled = await value;
    } catch (error) {
      fulfilled = false;
      settled = error;
    }
    if (fulfilled && isRejects) {
      throw new Error(
        withLabel(
          `expect(received).rejects.${name}()\n\nExpected promise that rejects\nReceived promise that resolved: ${describe(settled)}`,
        ),
      );
    }
    if (!fulfilled && !isRejects) {
      throw new Error(
        withLabel(
          `expect(received).resolves.${name}()\n\nExpected promise that resolves\nReceived promise that rejected: ${describe(settled)}`,
        ),
      );
    }
    let received = settled;
    // Jest's toThrow accepts the settled value itself when it is an Error (the rejection
    // reason, or a resolved Error); everything else must be a throwing function.
    if ((name === "toThrow" || name === "toThrowError") && typeof settled !== "function" && isError(settled)) {
      received = () => {
        throw settled;
      };
    }
    let expectation = label === undefined ? expectFn(received) : expectFn(received, label);
    if (negated) expectation = expectation.not;
    const matcher = expectation[name];
    if (typeof matcher !== "function") {
      throw new TypeError(`expect(...).${kind}.${name} is not a function`);
    }
    return matcher.$apply(expectation, args);
  }

  function make(negated: boolean) {
    return new Proxy(Object.create(null), {
      get(_target, name) {
        if (name === "not") return make(!negated);
        if (name === "resolves" || name === "rejects") {
          throw new TypeError(`Cannot chain .${name}() after .${kind}()`);
        }
        // Not thenable: `await expect(p).resolves` must not await the proxy itself.
        if (typeof name !== "string" || name === "then") return undefined;
        return function (...args) {
          return run(name, args, negated);
        };
      },
    });
  }

  return make(isNot);
}
