// `test`, `describe` and the hooks of bun:test for a test file that CI may leave out (./every-build.ts). In a file that is left out they declare one skipped test and
// nothing else. `beforeAll` and `beforeEach` too: a hook of bun:test runs in a file whose tests are all skipped.
import {
  afterAll as afterAllOfBun,
  afterEach as afterEachOfBun,
  beforeAll as beforeAllOfBun,
  beforeEach as beforeEachOfBun,
  describe as describeOfBun,
  it as itOfBun,
  test as testOfBun,
} from "bun:test";
import { leftOutHere } from "./every-build";

const saidSo = new Set<string>();
function isThisFileLeftOut(): boolean {
  const path = leftOutHere();
  if (path === undefined) return false;
  if (!saidSo.has(path)) testOfBun.skip("not in every build: test/aot/every-build.txt. AOT_WHOLE=1 runs it", () => {});
  saidSo.add(path);
  return true;
}
// Whatever is read from it or chained to it, and whatever it is called with.
const declaresNothing: any = new Proxy(function () {}, { get: () => declaresNothing, apply: () => declaresNothing });
/** `declares`, but in a file that is left out it declares nothing. Asked at each declaration. */
export const unlessLeftOut = <T extends object>(declares: T): T =>
  new Proxy(declares, {
    apply: (_, self, operands) =>
      isThisFileLeftOut() ? declaresNothing : Reflect.apply(declares as Function, self, operands),
    get(_, name) {
      if (isThisFileLeftOut()) return declaresNothing;
      const value = Reflect.get(declares, name);
      // `each` and the likes of `skipIf` ask for the object that they were read from.
      return typeof value === "function" && /^(?:each|\w*[iI]f)$/.test(String(name))
        ? Function.prototype.bind.call(value, declares)
        : value;
    },
  });

export const test = unlessLeftOut(testOfBun);
export const it = unlessLeftOut(itOfBun);
export const describe = unlessLeftOut(describeOfBun);
export const beforeAll = unlessLeftOut(beforeAllOfBun);
export const beforeEach = unlessLeftOut(beforeEachOfBun);
// The body of a file that is left out has run all the same, and may have made what these put away. What a hook in front would have made is not there.
const evenIfLeftOut =
  (register: typeof afterAllOfBun): typeof afterAllOfBun =>
  (hook, ...rest) =>
    isThisFileLeftOut()
      ? register(async () => {
          try {
            await (hook as () => unknown)();
          } catch {}
        }, ...rest)
      : register(hook, ...rest);
export const afterAll = evenIfLeftOut(afterAllOfBun);
export const afterEach = evenIfLeftOut(afterEachOfBun);
