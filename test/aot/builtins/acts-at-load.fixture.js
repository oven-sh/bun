// acts-at-load.test.ts runs this once for each module of Bun and each of two places, the main thread and a Worker, in a process of its own.
// A module is loaded once, and what it requires at its top level is loaded with it, so only a process that has loaded nothing shows what one load does.
//
//   bun --expose-internals acts-at-load.fixture.js <main | worker> <specifier | file | -> <shape | ->
//
// It prints one line that begins with `mark`: what the load was seen to do, as JSON. Whatever else the process prints, the load has printed.
// "-" loads nothing. That run must see nothing, and the others are held against it: `shape` is the hash that it printed for its place, and a
// run that ends with another shape prints its rows too.
//
// Before the load it loads nothing itself but bun:jsc, which is native. It reads what a load has left at once and exits, so what a load starts
// for a later turn of the event loop does not run here.
//
// What it watches for a read: every global, the members of Date, Math, JSON, console, performance and process, and Error.captureStackTrace.
// What it cannot see: a read of a member of any other object (those of `Bun` take no getter), a read that native code makes of the
// environment, a read of a name that is set made through `Bun.env`, and `Object.keys(Bun.env)` or `Object.hasOwn(Bun.env, name)`, which
// run no code that a program can lay over the object.
const mark = "acts-at-load: ";

const { defineProperty, getOwnPropertyDescriptor, getOwnPropertyNames, getPrototypeOf, setPrototypeOf, keys } = Object;
const { ownKeys, apply } = Reflect;

// A first look at one of these makes it, and making it loads modules of the library: the streams, the queue of process.nextTick, the class
// Console, the clients of databases. So nothing here looks at them.
const madeByALook = new Map([
  [process, ["nextTick", "stdin", "stdout", "stderr"]],
  [console, ["Console", "_stdout", "_stderr"]],
  [Bun, ["sql", "SQL", "postgres"]],
]);

// A module that holds an import statement, as a program has it. `require(specifier)` would itself lay an entry into require.cache for every
// name that does not begin with "node:", whether or not the module was loaded before. The module hands on what it imported, and the
// read of a name of that below runs the load in a Bun that leaves a load to the first read.
const importing = specifier => {
  const statements = specifier === "-" ? "" : `import * as all from ${JSON.stringify(specifier)}; export default all;`;
  return `data:text/javascript,${encodeURIComponent(statements)}`;
};

function observe(specifier, shapeOfNoLoad) {
  const counts = require("bun:jsc").heapStats;
  const emitter = getPrototypeOf(process);

  const seen = { environment: new Set(), read: new Set(), called: new Set(), written: new Set() };
  let isLoading = false;
  const note = (set, name) => {
    if (isLoading) set.add(name);
  };

  // What is there before the load. Nothing above this line may make any of it.
  const before = {
    counts: counts().objectTypeCounts,
    cache: new Set(keys(require.cache)),
    listeners: listenersOf(process),
    above: getPrototypeOf(emitter),
  };

  // The environment. `process.env` and `Bun.env` are one object, and it takes no getter. A read of a name that is not set goes on to the
  // proxy that is laid above the object here, and what reads `process.env` meets the proxy that stands for it.
  const environment = process.env;
  const asked = name => {
    if (typeof name === "string") note(seen.environment, name);
  };
  const wrote = name => note(seen.written, `process.env.${String(name)}`);
  const aboveEnvironment = getPrototypeOf(environment);
  setPrototypeOf(
    environment,
    new Proxy(aboveEnvironment, {
      get(target, name, receiver) {
        asked(name);
        return Reflect.get(target, name, receiver);
      },
      has(target, name) {
        asked(name);
        return Reflect.has(target, name);
      },
    }),
  );
  const standsForEnvironment = new Proxy(environment, {
    get(target, name) {
      asked(name);
      return Reflect.get(target, name);
    },
    has(target, name) {
      asked(name);
      return Reflect.has(target, name);
    },
    getOwnPropertyDescriptor(target, name) {
      asked(name);
      return Reflect.getOwnPropertyDescriptor(target, name);
    },
    ownKeys(target) {
      note(seen.environment, "*");
      return ownKeys(target);
    },
    set(target, name, value) {
      wrote(name);
      return Reflect.set(target, name, value);
    },
    defineProperty(target, name, descriptor) {
      wrote(name);
      return Reflect.defineProperty(target, name, descriptor);
    },
    deleteProperty(target, name) {
      wrote(name);
      return Reflect.deleteProperty(target, name);
    },
  });

  // A property that a program can replace becomes a getter and a setter that say so. `called`: a call of the function is noted as well.
  // After the load each is put back as it was, or as the load left it, so that the shape below is the one that a program would find.
  const putBack = [];
  function watch(holder, name, path, { value: inItsPlace, called = false } = {}) {
    const descriptor = getOwnPropertyDescriptor(holder, name);
    // `process.emit` is inherited: a program replaces it by laying its own over it.
    const isInherited = descriptor === undefined;
    if (!isInherited && !descriptor.configurable) return;
    const isAccessor = !isInherited && !("value" in descriptor);
    const noting = value => {
      if (!called || typeof value !== "function") return value;
      const wrapper = function (...operands) {
        note(seen.called, path);
        return apply(value, this, operands);
      };
      defineProperty(wrapper, "name", { value: value.name, configurable: true });
      defineProperty(wrapper, "length", { value: value.length, configurable: true });
      return wrapper;
    };
    const held = isInherited || isAccessor ? undefined : noting(inItsPlace ?? descriptor.value);
    let written;
    const laid = {
      configurable: true,
      enumerable: isInherited ? false : descriptor.enumerable,
      get() {
        note(seen.read, path);
        if (written !== undefined) return written.value;
        if (isAccessor) return descriptor.get?.call(this);
        return isInherited ? getPrototypeOf(holder)[name] : held;
      },
      set(next) {
        note(seen.written, path);
        if (isAccessor) descriptor.set?.call(this, next);
        else written = { value: next };
      },
    };
    defineProperty(holder, name, laid);
    putBack.push(() => {
      // The load has defined it anew.
      if (getOwnPropertyDescriptor(holder, name)?.get !== laid.get) return seen.written.add(path);
      if (written !== undefined) {
        const enumerable = isInherited || descriptor.enumerable;
        defineProperty(holder, name, { configurable: true, enumerable, writable: true, value: written.value });
      } else if (isInherited) {
        delete holder[name];
      } else {
        defineProperty(holder, name, descriptor);
      }
    });
  }

  // Which of these a compiled program may replace, the test asks the table of built-ins.
  for (const name of getOwnPropertyNames(globalThis)) {
    if (name === "globalThis" || name === "process" || name === "Bun") continue;
    watch(globalThis, name, name, { called: name === "addEventListener" });
  }
  for (const [holder, path] of [
    [Date, "Date"],
    [Math, "Math"],
    [JSON, "JSON"],
    [console, "console"],
    [performance, "performance"],
    [getPrototypeOf(performance), "performance"],
    [process, "process"],
  ]) {
    for (const name of getOwnPropertyNames(holder)) {
      if (madeByALook.get(holder)?.includes(name) || name === "constructor" || name === "env") continue;
      watch(holder, name, `${path}.${name}`, { called: holder === console || name === "emitWarning" });
    }
  }
  watch(Error, "captureStackTrace", "Error.captureStackTrace");
  watch(process, "emit", "process.emit");
  watch(process, "env", "process.env", { value: standsForEnvironment });

  // A channel of node:diagnostics_channel is kept in a map that lets go of it, and the map asks to be told when it is gone.
  const registered = [];
  const register = FinalizationRegistry.prototype.register;
  FinalizationRegistry.prototype.register = function (target, held, ...rest) {
    if (isLoading) registered.push([target, held]);
    return apply(register, this, [target, held, ...rest]);
  };

  const program = importing(specifier);
  let threw = null;
  isLoading = true;
  try {
    void require(program).default?.default;
  } catch (error) {
    threw = String(error?.message ?? error).split("\n")[0];
  }
  isLoading = false;
  FinalizationRegistry.prototype.register = register;
  for (const restore of putBack) restore();
  setPrototypeOf(environment, aboveEnvironment);

  // A timer that the load made and cleared is gone with this.
  Bun.gc(true);
  const after = { counts: counts().objectTypeCounts, listeners: listenersOf(process) };
  const more = name => (after.counts[name] ?? 0) - (before.counts[name] ?? 0);
  const hasMoreListeners = ([name, count]) => count !== (before.listeners.get(name) ?? 0);
  const observed = {
    threw,
    environment: [...seen.environment].sort(),
    read: [...seen.read].sort(),
    called: [...seen.called].sort(),
    written: [...seen.written].sort(),
    listeners: [...after.listeners].filter(hasMoreListeners).map(([name]) => name),
    cache: keys(require.cache).filter(key => !before.cache.has(key) && !key.startsWith("data:")),
    tick: more("NextTickQueue") > 0,
    timers: more("Timeout") + more("Immediate"),
    chain: getPrototypeOf(emitter) !== before.above,
  };
  // From here on this looks at everything, and so makes what is made at a first look.
  const rows = shapeOf(emitter);
  observed.shape = Bun.hash(JSON.stringify(rows)).toString(36);
  if (observed.shape !== shapeOfNoLoad) observed.rows = rows;
  observed.channels = registered.length === 0 ? [] : namesOfChannels(registered);
  observed.loop = loopOf();
  return observed;
}

function listenersOf(emitter) {
  return new Map(emitter.eventNames().map(name => [String(name), emitter.listenerCount(name)]));
}

function namesOfChannels(registered) {
  const { Channel } = require("node:diagnostics_channel");
  return registered.flatMap(([target, name]) => (target instanceof Channel ? [String(name)] : [])).sort();
}

// What keeps the event loop going. The module that answers loads much of the library, so it is asked after everything else.
// `tasks` and `concurrentTasksEmpty` change as other threads finish, and `iteration` counts.
function loopOf() {
  const { iteration, tasks, concurrentTasksEmpty, ...loop } = require("bun:internal-for-testing").getEventLoopStats();
  return loop;
}

const nameOf = key => (typeof key === "symbol" ? `@@${key.description}` : key);
const isObject = value => (typeof value === "object" && value !== null) || typeof value === "function";

// The properties of the global object, of `process` and of `Bun`, and of what they hold, three steps deep: names, attributes, and what kind of
// value, with the text of a function. No other text, no number and no address, so two processes that did the same print the same.
function shapeOf(emitter) {
  const textOf = Function.prototype.call.bind(Function.prototype.toString);
  const hashOfText = value => Bun.hash(textOf(value)).toString(36);
  const paths = new Map();
  const rows = {};
  const queue = [];
  const reach = (object, path, depth) => {
    if (paths.has(object)) return;
    paths.set(object, path);
    queue.push([object, path, depth]);
  };
  reach(globalThis, "globalThis", 0);
  reach(process, "process", 0);
  reach(Bun, "Bun", 0);
  const describe = value => {
    if (!isObject(value)) return typeof value === "boolean" || value == null ? String(value) : typeof value;
    return paths.get(value) ?? (typeof value === "function" ? `function ${hashOfText(value)}` : "object");
  };
  for (let next = 0; next < queue.length; next++) {
    const [object, path, depth] = queue[next];
    // What a CommonJS file has required is listed under `process.mainModule`.
    if (path === "process.mainModule") continue;
    const row = [];
    const values = [];
    for (const name of ownKeys(object).sort((left, right) => (nameOf(left) < nameOf(right) ? -1 : 1))) {
      if (madeByALook.get(object)?.includes(name)) continue;
      const descriptor = getOwnPropertyDescriptor(object, name);
      if (descriptor === undefined) continue;
      const attributes =
        (descriptor.writable ? "w" : "") + (descriptor.enumerable ? "e" : "") + (descriptor.configurable ? "c" : "");
      if ("value" in descriptor) {
        if (depth < 3 && isObject(descriptor.value)) reach(descriptor.value, `${path}.${nameOf(name)}`, depth + 1);
        values.push([name, attributes, descriptor.value]);
      } else {
        const halves = (descriptor.get ? " get" : "") + (descriptor.set ? " set" : "");
        row.push(`${nameOf(name)} ${attributes} accessor${halves}`);
      }
    }
    // What is above the prototype of `process` is the chain, which is asked by itself.
    const above = object === emitter ? null : getPrototypeOf(object);
    if (depth < 3 && isObject(above)) reach(above, `${path}.[[Prototype]]`, depth + 1);
    for (const [name, attributes, value] of values) row.push(`${nameOf(name)} ${attributes} ${describe(value)}`);
    if (object !== emitter) row.push(`[[Prototype]] ${describe(above)}`);
    row.push(`[[Extensible]] ${Object.isExtensible(object)}`);
    if (typeof object === "function") row.push(`[[Text]] ${hashOfText(object)}`);
    rows[path] = row;
  }
  return rows;
}

if (Bun.isMainThread) {
  const [place, specifier, shape] = process.argv.slice(2);
  const print = observed => {
    // Not console.log: the load may have left another in its place. A pipe takes a part of a long line at a time.
    const { writeSync } = require("node:fs");
    // On a line of its own, whatever the load has printed.
    let bytes = Buffer.from(`\n${mark}${JSON.stringify(observed)}\n`);
    while (bytes.length > 0) {
      try {
        bytes = bytes.subarray(writeSync(1, bytes));
      } catch (error) {
        // The pipe is full and the load has made it one that does not wait. The test is emptying it.
        if (error.code !== "EAGAIN") throw error;
      }
    }
    process.exit(0);
  };
  if (place === "worker") {
    const worker = new Worker(import.meta.path, { argv: [place, specifier, shape] });
    worker.onmessage = event => print(event.data);
    worker.onerror = event => {
      require("node:fs").writeSync(2, `the worker failed: ${event.message}\n`);
      process.exit(1);
    };
  } else {
    print(observe(specifier, shape));
  }
} else {
  postMessage(observe(process.argv[3], process.argv[4]));
  // The main thread ends the process. Until then nothing that the load left for later may run, or it would print in some runs only.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
