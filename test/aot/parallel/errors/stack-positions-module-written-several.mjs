// Prints the places in the stack traces of errors that ordinary code throws, written over several lines.
import { EventEmitter } from "node:events";
const places = error =>
  String(error.stack)
    .split("\n")
    .filter(line => /stack-positions-module-written-several\.mjs/.test(line))
    .map(line => line.trim().replace(/\(?\S*stack-positions-module-written-several\.mjs:/, "").replace(/\)$/, ""))
    .join(" < ");
let count = 0;
function show(run) {
  count++;
  try {
    run();
    console.log(count, "no error");
  } catch (error) {
    console.log(count, error.constructor.name, places(error));
  }
}
async function showAsync(run) {
  count++;
  try {
    await run();
    console.log(count, "no error");
  } catch (error) {
    console.log(count, error.constructor.name, places(error));
  }
}
function fail(message = "fail") {
  throw new Error(message);
}
const config = { server: { port: 80 }, list: [1, 2, 3], missing: undefined };
class Base {
  constructor(options) {
    this.options = options;
    this.setup();
  }
  setup() {}
}
class Service extends Base {
  #secret = 1;
  static defaults = { retries: 3 };
  name = "service";
  setup() {
    if (this.options.broken) {
      fail("broken");
    }
  }
  get value() {
    return this.options.value.inner;
  }
  run(items) {
    return items
      .filter(item => item > 1)
      .map(item => {
        if (item === 3) {
          fail("three");
        }
        return item;
      });
  }
  async load(id) {
    await null;
    const record = await this.fetch(id);
    return record.data;
  }
  async fetch(id) {
    await null;
    if (id < 0) {
      throw new RangeError("negative");
    }
    return undefined;
  }
  *walk() {
    yield 1;
    fail("walk");
  }
}
show(() => {
  new Service({ broken: true });
});
show(() => {
  const service = new Service({});
  return service.value;
});
show(() => {
  const service = new Service({});
  service.run(config.list);
});
await showAsync(async () => {
  const service = new Service({});
  await service.load(1);
});
await showAsync(async () => {
  const service = new Service({});
  await service.load(-1);
});
show(() => {
  for (const step of new Service({}).walk()) {
    count += 0 * step;
  }
});
show(() => {
  const { server: { host: { name } } } = config;
  return name;
});
show(() => {
  const port = config.missing.port;
  return port;
});
show(() => {
  config.missing.port = 1;
});
show(() => {
  config.server.listen(
    config.server.port,
    () => {},
  );
});
show(() => {
  fail(
    "over",
    "lines",
  );
});
show(() => {
  const emitter = new EventEmitter();
  emitter.on("data", chunk => {
    fail(chunk);
  });
  emitter.emit("data", "chunk");
});
show(() => {
  const result = [3, 1, 2].sort((a, b) => {
    if (a === 1) fail("sort");
    return a - b;
  });
  return result;
});
show(() => {
  JSON.parse("{ bad json");
});
show(() => {
  const text = JSON.stringify({
    toJSON() {
      fail("toJSON");
    },
  });
  return text;
});
show(() => {
  switch (config.server.port) {
    case 80:
      fail("eighty");
      break;
    default:
      break;
  }
});
show(() => {
  try {
    fail("inner");
  } finally {
    count += 0;
  }
});
show(() => {
  try {
    fail("inner");
  } catch (error) {
    throw new Error("outer", { cause: error });
  }
});
show(() => {
  try {
    fail("inner");
  } catch (error) {
    throw error;
  }
});
show(() => {
  const value = config.missing ?? fail("default");
  return value;
});
show(() => {
  const message = `port ${config.server.port} host ${config.server.host.name}`;
  return message;
});
show(() => {
  const copy = {
    ...config,
    extra: config.missing.extra,
  };
  return copy;
});
show(() => {
  const all = [
    ...config.list,
    ...config.missing,
  ];
  return all;
});
show(() => {
  function helper(first, { second } = config.missing) {
    return first + second;
  }
  return helper(1, null);
});
show(() => {
  const make = () => () => () => fail("deep");
  make()()();
});
await showAsync(() => {
  return new Promise(() => {
    fail("executor");
  });
});
await showAsync(() =>
  Promise.resolve(1).then(value => {
    fail("then " + value);
  }),
);
await showAsync(async () => {
  await Promise.all([
    Promise.resolve(1),
    (async () => {
      await null;
      fail("all");
    })(),
  ]);
});
await showAsync(async () => {
  for await (const item of (async function* () {
    yield 1;
    fail("async generator");
  })()) {
    count += 0 * item;
  }
});
show(() => {
  const map = new Map([["a", 1]]);
  map.forEach((value, key) => {
    fail(key + value);
  });
});
show(() => {
  class Point {
    constructor(x) {
      this.x = x.value.inner;
    }
  }
  return new Point({});
});
show(() => {
  class Child extends Service {
    constructor() {
      this.early = 1;
      super({});
    }
  }
  return new Child();
});
show(() => {
  const object = {
    method() {
      return this.other();
    },
  };
  object.method();
});
show(() => {
  const fn = undefined;
  fn();
});
show(() => {
  config.list.notAFunction();
});
show(() => {
  config.list.map(undefined);
});
show(() => {
  null.x;
});
show(() => {
  const big = 1n + 1;
  return big;
});
show(() => {
  new (class {
    static {
      fail("static block");
    }
  })();
});
show(() => {
  let total = 0;
  for (let index = 0; index < 3; index++) {
    total += config.list[index].toFixed(index === 2 ? 200 : 1).length;
  }
  return total;
});
show(() => {
  const handler = {
    get(target, key) {
      return fail(String(key));
    },
  };
  return new Proxy({}, handler).anything;
});
show(() => {
  if (config.server.port === 80) {
    if (config.list.length) {
      config.missing.deep();
    }
  }
});
show(() => {
  return config.server.port > 1
    ? config.missing.a
    : config.missing.b;
});
show(() => {
  const value = config.list
    .map(item => item * 2)
    .find(item => item > 100)
    .toString();
  return value;
});
show(() => {
  (function main() {
    const service = new Service({});
    service.run(config.list);
    if (count) {
      count += 0;
    }
  })();
});
