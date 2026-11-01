// What declares the tests of a file declares nothing where CI leaves the file out: ./every-build.ts.
import { test as testOfBun } from "bun:test";
import { leftOutHere } from "./every-build";

// In a Bun with assertions what is read from `test` is a proxy of ./default-timeout.ts, which calls it on the object that it was read from, whatever `this` is. Its own
// `bind` would be read through that proxy and bind what lies behind it to the wrong object.
export const boundTo = (owner: object, method: Function) => Function.prototype.bind.call(method, owner);

// Asked at each declaration: a process that loads many test files loads this file once.
const saidSo = new Set<string>();
export function isThisFileLeftOut(): boolean {
  const path = leftOutHere();
  if (path === undefined) return false;
  if (!saidSo.has(path)) testOfBun.skip("not in every build: test/aot/every-build.txt. AOT_WHOLE=1 runs it", () => {});
  saidSo.add(path);
  return true;
}

// Whatever is read from it or chained to it, and whatever it is called with.
const declaresNothing: any = new Proxy(function () {}, { get: () => declaresNothing, apply: () => declaresNothing });

/** `declares`: `test`, `describe` or a hook. */
export const unlessLeftOut = <T extends object>(declares: T): T =>
  new Proxy(declares, {
    apply: (_, self, operands) =>
      isThisFileLeftOut() ? declaresNothing : Reflect.apply(declares as Function, self, operands),
    // `each` and the likes of `skipIf` ask for the object that they were read from.
    get(_, name) {
      if (isThisFileLeftOut()) return declaresNothing;
      const value = Reflect.get(declares, name);
      return typeof value === "function" && /^(?:each|\w*[iI]f)$/.test(String(name)) ? boundTo(declares, value) : value;
    },
  });
