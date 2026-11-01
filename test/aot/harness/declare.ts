// `test`, `describe` and the hooks of bun:test for a test file that CI may leave out (./every-build.ts). In a file that is left out they declare one skipped test and
// nothing else. The hooks too: a hook of bun:test runs in a file whose tests are all skipped.
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
      return typeof value === "function" && /^(?:each|\w*[iI]f)$/.test(String(name)) ? value.bind(declares) : value;
    },
  });

export const test = unlessLeftOut(testOfBun);
export const it = unlessLeftOut(itOfBun);
export const describe = unlessLeftOut(describeOfBun);
export const beforeAll = unlessLeftOut(beforeAllOfBun);
export const beforeEach = unlessLeftOut(beforeEachOfBun);
export const afterAll = unlessLeftOut(afterAllOfBun);
export const afterEach = unlessLeftOut(afterEachOfBun);
