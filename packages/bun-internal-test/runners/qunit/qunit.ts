import { deepEquals, inspect } from "bun";
import type { TestContext } from "bun-test";
import { Assert } from "./assert";
import type { DataInit, EachFn, Fn, Hooks, HooksFn, ModuleFn, TestEachFn, TestFn, TestOrEachFn } from "./qunit.d";

type Status = "todo" | "skip" | "only" | undefined;

type Module = {
  name: string;
  status: Status;
  before: Fn[];
  beforeEach: Fn[];
  afterEach: Fn[];
  after: Fn[];
  addHooks(hooks?: Hooks | HooksFn): void;
  addTest(name: string, status: Status, fn?: Fn): void;
  addTests(name: string, status: Status, data: DataInit, fn?: EachFn): void;
};

function newModule(context: TestContext, moduleName: string, moduleStatus?: Status): Module {
  const before: Fn[] = [];
  const beforeEach: Fn[] = [];
  const afterEach: Fn[] = [];
  const after: Fn[] = [];
  let tests = 0;
  const addTest = (name: string, status: Status, fn?: Fn) => {
    const runTest = async () => {
      if (fn === undefined) {
        return;
      }
      const assert = new Assert(context.expect);
      if (tests++ === 1) {
        for (const fn of before) {
          await fn(assert);
        }
      }
      for (const fn of beforeEach) {
        await fn(assert);
      }
      try {
        await fn(assert);
      } finally {
        for (const fn of afterEach) {
          await fn(assert);
        }
        // TODO: need a way to know when module is done
        if (false) {
          for (const fn of after) {
            await fn(assert);
          }
        }
        // TODO: configurable timeout
        await assert.close(100);
      }
    };
    hideFromStack(runTest);
    const addTest = () => {
      if (moduleStatus !== undefined) {
        status = moduleStatus;
      }
      if (status === undefined) {
        context.test(name, runTest);
      } else if (status === "skip" || status === "todo") {
        context.test.skip(name, runTest);
      } else {
        context.test.only(name, runTest);
      }
    };
    hideFromStack(addTest);
    if (moduleName) {
      context.describe(moduleName, addTest);
    } else {
      addTest();
    }
  };
  hideFromStack(addTest);
  if (moduleStatus === "skip" || moduleStatus === "todo") {
    context.test.skip(moduleName, () => {});
  }
  return {
    name: moduleName,
    status: moduleStatus,
    before,
    beforeEach,
    afterEach,
    after,
    addHooks(hooks) {
      if (hooks === undefined) {
        return;
      }
      if (typeof hooks === "object") {
        if (hooks.before !== undefined) {
          before.push(hooks.before);
        }
        if (hooks.beforeEach !== undefined) {
          beforeEach.push(hooks.beforeEach);
        }
        if (hooks.afterEach !== undefined) {
          afterEach.push(hooks.afterEach);
        }
        if (hooks.after !== undefined) {
          after.push(hooks.after);
        }
      } else {
        hooks({
          before(fn) {
            before.push(fn);
          },
          beforeEach(fn) {
            beforeEach.push(fn);
          },
          afterEach(fn) {
            afterEach.push(fn);
          },
          after(fn) {
            after.push(fn);
          },
        });
      }
    },
    addTest,
    addTests(name, status, data, fn) {
      let entries: [string, unknown][];
      if (Array.isArray(data)) {
        entries = data.map(value => [inspect(value), value]);
      } else {
        entries = Object.entries(data);
      }
      for (const [key, value] of entries) {
        context.describe(name, () => {
          addTest(key, status, fn ? assert => fn(assert, value) : undefined);
        });
      }
    },
  };
}
hideFromStack(newModule);

function hideFromStack(object: any): void {
  if (typeof object === "function") {
    Object.defineProperty(object, "name", {
      value: "::bunternal::",
    });
    return;
  }
  for (const name of Object.getOwnPropertyNames(object)) {
    Object.defineProperty(object[name], "name", {
      value: "::bunternal::",
    });
  }
}

function todo(name: string) {
  const todo = () => {
    throw new Error(`Not implemented: QUnit.${name}`);
  };
  hideFromStack(todo);
  return todo;
}

function newCallable<C, O>(callable: C, object: O): C & O {
  // @ts-expect-error
  return Object.assign(callable, object);
}

function newQUnit(context: TestContext): import("./qunit.d").QUnit {
  let module: Module = newModule(context, "");
  let modules: Module[] = [module];
  const addModule = (name: string, status?: Status, hooks?: Hooks | HooksFn, fn?: HooksFn) => {
    module = newModule(context, name, status);
    modules.push(module);
    module.addHooks(hooks);
    module.addHooks(fn);
  };
  hideFromStack(addModule);
  return {
    assert: Assert.prototype,
    hooks: {
      beforeEach(fn) {
        for (const module of modules) {
          module.beforeEach.push(fn);
        }
      },
      afterEach(fn) {
        for (const module of modules) {
          module.afterEach.push(fn);
        }
      },
    },
    start() {},
    module: newCallable<
      ModuleFn,
      {
        skip: ModuleFn;
        todo: ModuleFn;
        only: ModuleFn;
      }
    >(
      (name, hooks, fn) => {
        addModule(name, undefined, hooks, fn);
      },
      {
        skip(name, hooks, fn) {
          addModule(name, "skip", hooks, fn);
        },
        todo(name, hooks, fn) {
          addModule(name, "todo", hooks, fn);
        },
        only(name, hooks, fn) {
          addModule(name, "only", hooks, fn);
        },
      },
    ),
    test: newCallable<
      TestFn,
      {
        each: TestEachFn;
        skip: TestOrEachFn;
        todo: TestOrEachFn;
        only: TestOrEachFn;
      }
    >(
      (name, fn) => {
        module.addTest(name, undefined, fn);
      },
      {
        each: (name, data, fn) => {
          module.addTests(name, undefined, data, fn);
        },
        skip: newCallable<
          TestFn,
          {
            each: TestEachFn;
          }
        >(
          (name, fn) => {
            module.addTest(name, "skip", fn);
          },
          {
            each(name, data, fn) {
              module.addTests(name, "skip", data, fn);
            },
          },
        ),
        todo: newCallable<
          TestFn,
          {
            each: TestEachFn;
          }
        >(
          (name, fn) => {
            module.addTest(name, "todo", fn);
          },
          {
            each(name, data, fn) {
              module.addTests(name, "todo", data, fn);
            },
          },
        ),
        only: newCallable<
          TestFn,
          {
            each: TestEachFn;
          }
        >(
          (name, fn) => {
            module.addTest(name, "only", fn);
          },
          {
            each(name, data, fn) {
              module.addTests(name, "only", data, fn);
            },
          },
        ),
      },
    ),
    skip(name, fn) {
      module.addTest(name, "skip", fn);
    },
    todo(name, fn) {
      module.addTest(name, "todo", fn);
    },
    only(name, fn) {
      module.addTest(name, "only", fn);
    },
    dump: {
      maxDepth: Infinity,
      parse(data) {
        return inspect(data);
      },
    },
    extend(target: any, mixin) {
      return Object.assign(target, mixin);
    },
    equiv(a, b) {
      return deepEquals(a, b);
    },
    config: {},
    testDone: todo("testDone"),
    testStart: todo("testStart"),
    moduleDone: todo("moduleDone"),
    moduleStart: todo("moduleStart"),
    begin: todo("begin"),
    done: todo("done"),
    log: todo("log"),
    onUncaughtException: todo("onUncaughtException"),
    push: todo("push"),
    stack: todo("stack"),
    on: todo("on"),
  };
}

const { expect, describe, test, beforeAll, beforeEach, afterEach, afterAll } = Bun.jest(import.meta.path);

export const QUnit = newQUnit({
  expect,
  describe,
  test,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
});
export { Assert };

// @ts-expect-error
globalThis.QUnit = QUnit;
