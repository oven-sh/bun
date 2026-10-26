// A framework keeps the application's callbacks in an array that it also hands to a function the compiler cannot see, so
// anything may call them with anything. The program itself only ever hands them its context object and a bound function,
// so that is what the callbacks expect, and they test for it before they use it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported-with-counted-calls";

const framework = `
  var freeModule = typeof module == "object" && module && !module.nodeType && module;
  var inspect = (function () {
    try {
      return freeModule && freeModule.require && freeModule.require("util").inspect;
    } catch (e) {}
  })();

  function compose(middleware) {
    return function (context) {
      function dispatch(i) {
        const fn = middleware[i];
        if (!fn) return;
        return fn(context, dispatch.bind(null, i + 1));
      }
      return dispatch(0);
    };
  }

  class App {
    constructor() {
      this.middleware = [];
    }
    use(fn) {
      this.middleware.push(fn);
      return this;
    }
    handle(url) {
      const context = { url, status: 404, body: "", length: 0 };
      compose(this.middleware)(context);
      return context;
    }
    toString() {
      return inspect(this.middleware);
    }
  }

  module.exports = App;
`;

const application = `
  const App = require("./framework.js");

  const others = [
    { status: 1, url: "a", body: "b", length: 1 },
    { body: "b", status: 2, url: "a", length: 1 },
  ];

  const app = new App();
  app.use((ctx, next) => {
    ctx.length = ctx.url.length;
    next();
  });
  app.use((ctx, next) => {
    ctx.status = ctx.length > 2 ? 200 : 201;
    next();
  });
  app.use(ctx => {
    ctx.body = ctx.url + ctx.status + ctx.length;
  });

  let total = 0;
  const rounds = Number(process.argv[2]);
  for (let i = 0; i < rounds; i++) {
    const done = app.handle(i & 1 ? "/a" : "/bcd");
    const other = others[i & 1];
    total += done.status + done.body.length + other.status + other.url.length;
  }
  console.log(total === rounds * 210);
`;

async function countAccessesByName(folder: string) {
  const executable = join(folder, isWindows ? "application.exe" : "application");
  built(
    await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-count-arrivals", "./application.js", "--outfile", executable],
      folder,
      bunEnv,
    ),
  );
  const count = async (rounds: number) => {
    const path = join(folder, `counts-${rounds}`);
    const ran = await spawned([executable, String(rounds)], folder, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    let byName = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, what] = line.split("\t");
      if (what?.startsWith("arrival:")) byName += Number(count);
    }
    return byName;
  };
  return Math.round(((await count(4500)) - (await count(500))) / 4000);
}

describe("callbacks that anything may call", () => {
  test("expect what the program hands them", async () => {
    using dir = tempDir("aot-callbacks-anything-may-call", {
      "framework.js": framework,
      "application.js": application,
    });
    expect(await countAccessesByName(String(dir))).toBeLessThanOrEqual(6);
  }, 240_000);
});
