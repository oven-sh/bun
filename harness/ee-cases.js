// One case, one process, one JSON line: <bun> ee-cases.js <case> [tier] [pre]   (--list prints the cases)
//   tier  ftl | dfg | base | llint | default: picks the iteration count from ITERS; the JIT options themselves come
//         from the environment (BUN_JSC_*), the drivers set them
//   pre   none | inspect | keys: what is done to EventEmitter.prototype before the case is set up
// Environment: EE_ITERS=n replaces the iteration count; EE_HANDICAP=p makes every measured call of a hot case p
// percent longer; EE_MARK=n1,n2,reps (cold case: EE_MARK=1) is for icount.c.
// Times are CPU time (user+sys) in microseconds, see section 4 of the findings for thr_us, cpu_us, nthr_us, ncpu_us.
"use strict";
const [, , NAME, TIER = "default", PRE = "none"] = process.argv;
const TIERS = ["ftl", "dfg", "base", "llint", "default"];
const S = { v: 0 };
let events;
function EE() {
  if (events === undefined) {
    events = require("node:events");
    if (PRE === "inspect") S.v += Bun.inspect(events.prototype).length > 0 ? 0 : 1;
    else if (PRE === "keys") S.v += Object.keys(events.prototype).length > 0 ? 0 : 1;
  }
  return events;
}
// run(n) executes body n times. S and the keys of vars are the free variables of body, i is the iteration.
function loop(body, vars = {}) {
  const source = `return function run(n) { for (let i = 0; i < n; i++) { ${body} } };`;
  return new Function("S", ...Object.keys(vars), source)(S, ...Object.values(vars));
}
// Listeners with their own source each, so that a list of 3 is 3 different callees. any: the arguments may be
// missing or may not be numbers.
function listener(argc, j, any) {
  const params = ["a", "b", "c", "d", "e"].slice(0, argc);
  const sum = any ? params.map(p => `(typeof ${p} === "number" ? ${p} : 1)`) : params;
  const body = argc === 0 ? "S.v++;" : `S.v += ${sum.join(" + ")};`;
  return new Function("S", `return function l${argc}_${j}(${params.join(", ")}) { ${body} };`)(S);
}
function emitter(count, argc, options) {
  const e = new (EE())(options);
  for (let j = 0; j < count; j++) e.on("x", listener(argc, j));
  return e;
}
// _events is there before the constructor runs: the shape mode of streams.
function Shaped() {
  this._events = { close: undefined, error: undefined, prefinish: undefined, finish: undefined, drain: undefined, data: undefined, end: undefined, readable: undefined };
  EE().call(this);
}
function shaped() {
  if (Object.getPrototypeOf(Shaped.prototype) !== EE().prototype) Object.setPrototypeOf(Shaped.prototype, EE().prototype);
  return new Shaped();
}
// bench/emitter/implementations.mjs calls EventEmitter.setMaxListeners(Infinity) before every bench
function bench() {
  EE().setMaxListeners(Infinity);
  return EE();
}
const names256 = Array.from({ length: 256 }, (_, i) => "event" + i);
const prevent = "event => { event.preventDefault(); }";
const counting = "{ preventDefault() { S.v++; } }";

// The reference is the same source for every binary, and it is the kind of code an emitter is: calls through a
// method, property reads and writes, a typeof, a listener called with this. The state of the machine (a busy
// sibling hyperthread slows such code by up to 40%, a tight loop far less) changes the reference and the case
// alike. It allocates nothing: no collection starts in its rounds, and the garbage of the case is not its work.
function Twin() {
  this._events = { __proto__: null, x: undefined, y: undefined };
  this._count = 0;
}
Twin.prototype.set = function set(type, fn) {
  const events = this._events;
  if (events[type] === undefined) this._count++;
  events[type] = fn;
  return this;
};
Twin.prototype.clear = function clear(type, fn) {
  const events = this._events;
  const handler = events[type];
  if (handler === undefined) return this;
  if (handler === fn || handler.listener === fn) {
    this._count--;
    events[type] = undefined;
  }
  return this;
};
Twin.prototype.emit = function emit(type, a) {
  const handler = this._events[type];
  if (handler === undefined) return false;
  if (typeof handler === "function") {
    handler.call(this, a);
    return true;
  }
  for (let i = 0; i < handler.length; i++) handler[i].call(this, a);
  return true;
};
const T = { v: 0 };
const twin = new Twin().set("x", function twinListener(a) {
  T.v += a;
});
const twinOther = function twinOther() {};
function reference(n) {
  for (let i = 0; i < n; i++) {
    twin.emit("x", 1);
    twin.set("y", twinOther);
    twin.emit("z", 1);
    twin.clear("y", twinOther);
  }
}
// iterations of one round of the reference: about 2.5 ms of thread CPU time on build/release-base
const REF_ITERS = { ftl: 300000, dfg: 62000, base: 15000, llint: 4100, default: 300000 };
const REF_ROUND_US = 2500;

const hot = {};
for (const count of [0, 1, 3]) {
  for (const argc of [0, 1, 3, 5]) {
    hot[`emit_${count}l_${argc}a`] = () => {
      const e = emitter(count, argc);
      if (count === 0) e.on("other", listener(0, 9));
      return loop(`if (e.emit(${['"x"', 1, 2, 3, 4, 5].slice(0, argc + 1)})) S.v++;`, { e });
    };
  }
}
Object.assign(hot, {
  // no listener was ever added: _events is the empty object of the constructor
  emit_noevents: () => loop(`if (e.emit("x", 1)) S.v++;`, { e: emitter(0) }),
  emit_error_handled: () => loop(`e.emit("error", 1);`, { e: emitter(0).on("error", listener(1, 0)) }),
  emit_shape_1l_1a: () => loop(`e.emit("data", 1);`, { e: shaped().on("data", listener(1, 0)) }),
  emit_capture_1l_1a: () => loop(`e.emit("x", 1);`, { e: emitter(1, 1, { captureRejections: true }) }),
  emit_capture_3l_1a: () => loop(`e.emit("x", 1);`, { e: emitter(3, 1, { captureRejections: true }) }),
  // the listener returns a promise: emit() gives it a rejection handler every time
  emit_capture_promise() {
    const e = emitter(0, 0, { captureRejections: true });
    const promise = Promise.resolve(1);
    return loop(`e.emit("x", 1);`, { e: e.on("x", () => promise) });
  },
  // 256 event names on one emitter, every emit with another name
  emit_names256() {
    const e = emitter(0);
    for (const name of names256) e.on(name, listener(1, 0));
    return loop(`e.emit(names[i & 255], 1);`, { e, names: names256 });
  },
  on_off: () => loop(`e.on("x", f); e.off("x", f);`, { e: emitter(0), f: listener(0, 0) }),
  // the emitter keeps a listener of another event: off() deletes the key instead of replacing _events
  on_off_other: () => loop(`e.on("x", f); e.off("x", f);`, { e: emitter(0).on("other", listener(0, 1)), f: listener(0, 0) }),
  on_off_second: () => loop(`e.addListener("x", f); e.removeListener("x", f);`, { e: emitter(1, 0), f: listener(0, 5) }),
  on_off_names256() {
    const e = emitter(0);
    for (let i = 0; i < 256; i += 2) e.on(names256[i], listener(0, 1));
    return loop(`const name = names[(i * 2 + 1) & 255]; e.on(name, f); e.off(name, f);`, { e, f: listener(0, 0), names: names256 });
  },
  on_off_newlistener() {
    const e = emitter(0).on("newListener", listener(2, 0, true)).on("removeListener", listener(2, 1, true));
    return loop(`e.on("x", f); e.off("x", f);`, { e, f: listener(0, 0) });
  },
  once_emit: () => loop(`e.once("x", f); e.emit("x", 1);`, { e: emitter(0), f: listener(1, 0) }),
  once_emit_second: () => loop(`e.once("x", f); e.emit("x", 1);`, { e: emitter(1, 1), f: listener(1, 5) }),
  prepend_once_emit: () => loop(`e.prependOnceListener("x", f); e.emit("x", 1);`, { e: emitter(1, 1), f: listener(1, 5) }),
  // 3 listeners a b c: b leaves the middle and is added at the end, then c does the same, and the order is a b c again
  remove_mid3() {
    const e = emitter(3, 0);
    const [, b, c] = e.rawListeners("x");
    return loop(`e.removeListener("x", b); e.on("x", b); e.removeListener("x", c); e.on("x", c);`, { e, b, c });
  },
  prepend_remove: () => loop(`e.prependListener("x", f); e.removeListener("x", f);`, { e: emitter(2, 0), f: listener(0, 5) }),
  // listeners 2 to 10 of a new emitter: every one of them reads the default of max listeners
  add_10() {
    const fns = Array.from({ length: 10 }, (_, j) => listener(0, j));
    return loop(`const e = new E(); for (let j = 0; j < 10; j++) e.on("x", fns[j]); S.v += e.listenerCount("x");`, { E: EE(), fns });
  },
  listener_count: () => loop(`S.v += e.listenerCount("x");`, { e: emitter(3, 0) }),
  listener_count_fn() {
    const e = emitter(3, 0);
    return loop(`S.v += e.listenerCount("x", f);`, { e, f: e.rawListeners("x")[1] });
  },
  event_names: () => loop(`S.v += e.eventNames().length;`, { e: emitter(1, 0).on("y", listener(0, 1)).on("z", listener(0, 2)) }),
  listeners_raw: () => loop(`S.v += e.listeners("x").length + e.rawListeners("y").length;`, { e: emitter(3, 0).once("y", listener(0, 4)) }),
  get_max_default: () => loop(`S.v += e.getMaxListeners();`, { e: emitter(1, 0) }),
  get_max_instance: () => loop(`S.v += e.getMaxListeners();`, { e: emitter(1, 0).setMaxListeners(20) }),
  set_max: () => loop(`e.setMaxListeners(i & 15);`, { e: emitter(1, 0) }),
  remove_all() {
    const body = `const e = new E(); e.on("a", f); e.on("b", f); e.on("b", g); e.removeAllListeners("a"); e.removeAllListeners();`;
    return loop(body, { E: EE(), f: listener(0, 0), g: listener(0, 1) });
  },
  construct: () => loop(`S.v += (ring[i & 255] = new E())._eventsCount;`, { E: EE(), ring: new Array(256).fill(null) }),
  construct_subclass() {
    class Sub extends EE() {
      constructor() {
        super();
        this.a = 1;
      }
    }
    return loop(`S.v += (ring[i & 255] = new Sub()).a;`, { Sub, ring: new Array(256).fill(null) });
  },
  // what a stream does in its life: constructor in shape mode, on, once, 16 chunks, end, removeListener
  shape_life() {
    const body = `const s = shaped(); s.on("data", data); s.once("end", end); s.on("error", error);
      for (let j = 0; j < 16; j++) s.emit("data", 1);
      s.emit("end"); s.removeListener("data", data); s.removeListener("error", error);`;
    return loop(body, { shaped, data: listener(1, 0), end: listener(0, 1), error: listener(1, 2) });
  },
  // a receiver that never went through the constructor
  plain_receiver() {
    const body = `const o = { __proto__: proto }; o.on("x", f); o.emit("x", 1); o.off("x", f);`;
    return loop(body, { proto: EE().prototype, f: listener(1, 0) });
  },

  // the bodies of bench/emitter/microbench.mjs, microbench_once.mjs and realworld_stream.mjs
  bench_single_emit: () => loop(`e.emit("hello", ${counting});`, { e: new (bench())().on("hello", eval(prevent)) }),
  // one more listener in every iteration, 1000 emits to all of them (the file has 10_000 and a clock for the rounds)
  bench_on_emit_x1000() {
    const body = `let called = false; e.on("hey", ${prevent});
      for (let k = 0; k < 1000; k++) e.emit("hey", { preventDefault() { S.v++; called = true; } });
      if (!called) throw new Error("not called");`;
    return loop(body, { e: new (bench())() });
  },
  bench_once_test1() {
    const e = new (bench())().on("hello", eval(prevent));
    return loop(`e.once("hello", ${prevent}); e.emit("hello", ${counting});`, { e });
  },
  bench_once_test2: () => loop(`e.once("hello", ${prevent}); e.emit("hello", ${counting});`, { e: new (bench())() }),
  bench_stream_simulation() {
    const chunks = Array.from({ length: 1024 }, (_, j) => new Uint8Array(1024).fill(j & 255));
    const body = `let id = 0; const received = []; const stream = new E();
      stream.on("start", res => { if (res.status !== 200) throw new Error("not 200"); });
      stream.on("data", req => { received.push(req); });
      stream.on("end", ${prevent});
      stream.emit("start", { status: 200 });
      for (const chunk of chunks) stream.emit("data", chunk);
      stream.emit("end", { preventDefault() { id++; } });
      if (id !== 1 || received.length !== 1024) throw new Error("not implemented right");
      S.v += received.length;`;
    return loop(body, { E: bench(), chunks });
  },

  // the native emitter of process, which this task does not change: the cases of bench/emitter/process.mjs
  process_on_off: () => loop(`process.on("ee-bench", f); process.off("ee-bench", f);`, { f: listener(0, 0) }),
  process_emit_0l: () => loop(`if (process.emit("ee-bench", 1)) S.v++;`),
  process_emit_1l() {
    process.on("ee-bench", listener(1, 0));
    return loop(`process.emit("ee-bench", 1);`);
  },
  process_emit_3l() {
    for (let j = 0; j < 3; j++) process.on("ee-bench", listener(1, j));
    return loop(`process.emit("ee-bench", 1);`);
  },
  process_listener_count() {
    for (let j = 0; j < 3; j++) process.on("ee-bench", listener(1, j));
    return loop(`S.v += process.listenerCount("ee-bench");`);
  },
  // The printer of warnings is a 'warning' listener, it is removed. The event is emitted in a later tick: the loop
  // gives way to it after every 1024 warnings.
  process_emit_warning() {
    process.removeAllListeners("warning").on("warning", () => {});
    const turn = () => new Promise(resolve => setImmediate(resolve));
    return async n => {
      for (let i = 0; i < n; i++) {
        process.emitWarning("ee-bench");
        if ((i & 1023) === 1023) await turn();
      }
      await turn();
    };
  },
});

// node:stream, node:net and node:http on 127.0.0.1, ports chosen by the kernel (listen(0))
const count = data => {
  S.v += data.length;
};
const listen = server =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
const close = server => new Promise(resolve => server.close(() => resolve()));
const times = one => async n => {
  for (let i = 0; i < n; i++) await one();
};
function source(chunks) {
  const chunk = Buffer.alloc(1024, 97);
  return new (require("node:stream").Readable)({
    read() {
      this.push(chunks-- > 0 ? chunk : null);
    },
  });
}
function pipeOf(chunks) {
  const target = new (require("node:stream").Writable)({
    write(data, encoding, callback) {
      count(data);
      callback();
    },
  });
  return new Promise((resolve, reject) => {
    target.once("finish", resolve).once("error", reject);
    source(chunks).once("error", reject).pipe(target);
  });
}
async function netEcho() {
  const net = require("node:net");
  const message = Buffer.alloc(64, 98);
  const server = net.createServer(socket => {
    socket.on("data", data => socket.write(data));
    socket.on("error", () => {});
  });
  const port = await listen(server);
  const client = net.connect(port, "127.0.0.1");
  await new Promise((resolve, reject) => client.once("connect", resolve).once("error", reject));
  client.setNoDelay(true);
  const run = n =>
    new Promise((resolve, reject) => {
      let pending = message.length;
      const onData = data => {
        count(data);
        if ((pending -= data.length) > 0) return;
        if (--n === 0) {
          client.removeListener("data", onData).removeListener("error", reject);
          return resolve();
        }
        pending = message.length;
        client.write(message);
      };
      client.on("data", onData).once("error", reject);
      client.write(message);
    });
  return { run, stop: () => (client.destroy(), close(server)) };
}
async function httpKeepAlive() {
  const http = require("node:http");
  const body = Buffer.alloc(512, 100);
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-length": body.length });
      res.end(body);
    });
  });
  const port = await listen(server);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const one = () =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/x", method: "GET", agent }, res => {
        res.on("data", count).once("end", resolve).once("error", reject);
      });
      req.once("error", reject);
      req.end();
    });
  const stop = () => {
    agent.destroy();
    server.closeAllConnections?.();
    return close(server);
  };
  return { run: times(one), stop };
}
const macro = {
  // one Readable piped into one Writable, n chunks of 1 KiB
  pipe_chunks: () => ({ run: n => pipeOf(n) }),
  // n pipes of 4 chunks: new streams every time, mostly on / once / removeListener / emit of few events
  pipe_short: () => ({ run: times(() => pipeOf(4)) }),
  // one connection, 64 bytes there and back, n times
  net_echo: netEcho,
  // one keep-alive connection, n requests
  http_keepalive: httpKeepAlive,
};

// The first use in a new process: the body runs once. cold_control has an empty body: its numbers are what the
// measurement itself costs.
const add = a => {
  S.v += a;
};
const cold = {
  cold_control() {},
  cold_require_events() {
    S.v += typeof EE() === "function" ? 1 : 0;
  },
  cold_first_on_emit() {
    const e = new (EE())();
    e.on("x", add);
    e.emit("x", 1);
    e.off("x", add);
  },
  cold_all_methods() {
    const e = new (EE())();
    e.setMaxListeners(20);
    S.v += e.getMaxListeners();
    e.on("x", add).addListener("x", add).prependListener("x", add).once("y", add).prependOnceListener("y", add);
    e.emit("x", 1);
    e.emit("y", 1);
    S.v += e.listeners("x").length + e.rawListeners("x").length + e.listenerCount("x") + e.eventNames().length;
    e.off("x", add).removeListener("x", add).removeAllListeners();
  },
  cold_process_on_signal() {
    process.on("SIGINT", add);
    process.off("SIGINT", add);
  },
  cold_process_on_emit() {
    process.on("ee-bench", add);
    process.emit("ee-bench", 1);
    process.off("ee-bench", add);
  },
  cold_require_stream() {
    S.v += typeof require("node:stream") === "function" ? 1 : 0;
  },
  cold_require_http() {
    S.v += typeof require("node:http") === "object" ? 1 : 0;
  },
};

// Iterations of the measured loop, fixed per case and tier: [ftl, dfg, base, llint, default]. One number: the same
// for every tier. Calibrated once on build/release-base (7c48989598) to about 60 ms of thread CPU time, then
// raised where a synchronous compilation of the ftl tier fell into the measured loop.
const ITERS = {
  emit_0l_0a: [24000000, 1400000, 920000, 260000, 5600000],
  emit_0l_1a: [25000000, 1300000, 810000, 270000, 5200000],
  emit_0l_3a: [25000000, 2200000, 790000, 240000, 8800000],
  emit_0l_5a: [26000000, 1900000, 670000, 220000, 7600000],
  emit_1l_0a: [25000000, 1400000, 550000, 190000, 5600000],
  emit_1l_1a: [20000000, 1300000, 500000, 190000, 5200000],
  emit_1l_3a: [26000000, 1800000, 540000, 150000, 7200000],
  emit_1l_5a: [30000000, 880000, 290000, 120000, 3520000],
  emit_3l_0a: [6500000, 720000, 350000, 110000, 2880000],
  emit_3l_1a: [6000000, 670000, 270000, 97000, 2680000],
  emit_3l_3a: [5900000, 720000, 270000, 91000, 2880000],
  emit_3l_5a: [1400000, 340000, 200000, 64000, 1360000],
  emit_noevents: [28000000, 1500000, 800000, 260000, 6000000],
  emit_error_handled: [25000000, 650000, 300000, 99000, 2600000],
  emit_shape_1l_1a: [27000000, 1500000, 500000, 190000, 6000000],
  emit_capture_1l_1a: [25000000, 1200000, 550000, 170000, 4800000],
  emit_capture_3l_1a: [6900000, 670000, 290000, 97000, 2680000],
  emit_capture_promise: [700000, 520000, 200000, 92000, 700000],
  emit_names256: [2900000, 1000000, 470000, 170000, 2900000],
  on_off: [3100000, 1100000, 250000, 66000, 3100000],
  on_off_other: [300000, 150000, 110000, 59000, 300000],
  on_off_second: [1300000, 650000, 160000, 39000, 1300000],
  on_off_names256: [13000, 13000, 13000, 55000, 13000],
  on_off_newlistener: [300000, 120000, 65000, 27000, 300000],
  once_emit: [880000, 260000, 73000, 25000, 880000],
  once_emit_second: [560000, 170000, 57000, 25000, 560000],
  prepend_once_emit: [590000, 200000, 58000, 19000, 590000],
  remove_mid3: [650000, 300000, 55000, 16000, 650000],
  prepend_remove: [1600000, 700000, 160000, 28000, 1600000],
  add_10: [170000, 75000, 21000, 5400, 170000],
  listener_count: [24000000, 4400000, 1200000, 500000, 17600000],
  listener_count_fn: [9900000, 2000000, 720000, 140000, 8000000],
  event_names: [13000000, 8100000, 1100000, 350000, 13000000],
  listeners_raw: [2400000, 740000, 130000, 39000, 2400000],
  get_max_default: [23000000, 19000000, 1700000, 440000, 23000000],
  get_max_instance: [23000000, 20000000, 1600000, 530000, 23000000],
  set_max: [2800000, 2700000, 2500000, 590000, 2800000],
  remove_all: [1200000, 320000, 77000, 17000, 1200000],
  construct: [1600000, 1300000, 400000, 71000, 1600000],
  construct_subclass: [1900000, 1600000, 350000, 58000, 1900000],
  shape_life: [340000, 46000, 15000, 4200, 184000],
  plain_receiver: [610000, 410000, 140000, 35000, 610000],
  bench_single_emit: [6800000, 1100000, 420000, 120000, 4400000],
  bench_on_emit_x1000: [72, 72, 48, 24, 72],
  bench_once_test1: [480000, 170000, 53000, 17000, 480000],
  bench_once_test2: [750000, 230000, 69000, 34000, 750000],
  bench_stream_simulation: [3600, 730, 360, 130, 2920],
  process_on_off: [140000, 98000, 120000, 82000, 140000],
  process_emit_0l: [1300000, 1300000, 2000000, 430000, 1300000],
  process_emit_1l: [610000, 510000, 480000, 220000, 610000],
  process_emit_3l: [230000, 240000, 210000, 130000, 230000],
  process_listener_count: [1600000, 1400000, 1100000, 560000, 1600000],
  process_emit_warning: [15000, 14000, 12000, 6400, 15000],
  pipe_chunks: [1800000],
  pipe_short: [8000],
  net_echo: [6000],
  http_keepalive: [1000],
};
// process.cpuUsage() brings the CPU time of the calling thread up to date before it reads it.
// process.threadCpuUsage() does not: read alone it moves in steps of a scheduler tick (1 ms here). So the thread
// clock is always read right after the process clock.
function clocks() {
  const all = process.cpuUsage();
  const own = process.threadCpuUsage();
  return [all.user + all.system, own.user + own.system];
}
const line = fields => console.log(JSON.stringify({ case: NAME, tier: TIER, pre: PRE, ...fields, sink: S.v }));
function iterations() {
  if (process.env.EE_ITERS) return Number(process.env.EE_ITERS);
  const fixed = ITERS[NAME];
  if (fixed === undefined) throw new Error("no iteration count for " + NAME);
  return fixed[TIERS.indexOf(TIER)] ?? fixed[0];
}
// A full collection after every measured call and after every round of the reference: [process, thread] CPU
// time of it. The reference allocates nothing, so the collection after it is what a collection costs when there
// is nothing to collect, and the collection after the call costs that plus the garbage of the call: the
// difference belongs to the call (it is in cpu_us). Without these collections a call of a case that allocates
// little has one collection or none, and which of the two is decided by a few percent more or less garbage.
function collect() {
  const before = clocks();
  Bun.gc(true);
  now = clocks();
  return [now[0] - before[0], now[1] - before[1]];
}
// [process, thread] CPU time of fn()
let now;
async function timed(fn) {
  const before = now;
  await fn();
  now = clocks();
  return [now[0] - before[0], now[1] - before[1]];
}
async function runHot(setup) {
  const run = await setup();
  const per = Math.max(1, Math.round(iterations() / 24));
  const refN = REF_ITERS[TIER] ?? REF_ITERS.ftl;
  const handicap = Math.round((per * Number(process.env.EE_HANDICAP ?? 0)) / 100);
  await run(Math.min(per, 64));
  for (let r = 0; r < 24; r++) reference(refN);
  Bun.gc(true);
  const sum = { cpu_us: 0, thr_us: 0, ncpu_us: 0, nthr_us: 0, gc_cpu_us: 0, ref_us: 0, warm_cpu_us: 0, warm_thr_us: 0 };
  const thirds = [0, 0, 0];
  now = clocks();
  for (let r = 0; r < 12; r++) {
    const [cpu, thr] = await timed(() => run(per));
    sum.warm_cpu_us += cpu;
    sum.warm_thr_us += thr;
  }
  collect();
  let before = (await timed(() => reference(refN)))[1];
  for (let r = 0; r < 24; r++) {
    const idle = collect();
    const call = await timed(() => run(per + handicap));
    const busy = collect();
    const after = (await timed(() => reference(refN)))[1];
    const scale = REF_ROUND_US / ((before + after) / 2);
    const cpu = call[0] + busy[0] - idle[0];
    sum.cpu_us += cpu;
    sum.thr_us += call[1];
    sum.ncpu_us += Math.round(cpu * scale);
    sum.nthr_us += Math.round(call[1] * scale);
    sum.gc_cpu_us += busy[0] - idle[0];
    sum.ref_us += after;
    thirds[Math.floor(r / 8)] += call[1];
    before = after;
  }
  if (process.env.EE_MARK) {
    const [n1, n2, reps] = process.env.EE_MARK.split(",").map(Number);
    const mark = Bun.nanoseconds;
    mark();
    for (let r = 0; r < reps; r++) {
      run(n1);
      mark();
      run(n2);
      mark();
    }
  }
  line({
    kind: "hot",
    iters: per * 24,
    ...sum,
    all_cpu_us: sum.warm_cpu_us + sum.cpu_us,
    all_thr_us: sum.warm_thr_us + sum.thr_us,
    // thread time of the first and of the last third of the measured loop: equal when the JIT has tiered up
    first_third_us: thirds[0],
    last_third_us: thirds[2],
  });
}
async function runMacro(setup) {
  if (PRE !== "none") EE();
  const { run, stop } = await setup();
  const per = Math.max(1, Math.round(iterations() / 12));
  await run(Math.min(per, 64));
  Bun.gc(true);
  const start = (now = clocks());
  for (let r = 0; r < 6; r++) await timed(() => run(per));
  const warmed = now;
  for (let r = 0; r < 12; r++) await timed(() => run(per));
  if (stop) await stop();
  line({
    kind: "macro",
    iters: per * 12,
    cpu_us: now[0] - warmed[0],
    thr_us: now[1] - warmed[1],
    all_cpu_us: now[0] - start[0],
    all_thr_us: now[1] - start[1],
  });
}
function runCold(body) {
  const { heapStats } = require("bun:jsc");
  const counted = ["Function", "FunctionExecutable", "UnlinkedFunctionExecutable", "FunctionCodeBlock", "Structure"];
  clocks();
  heapStats();
  Bun.gc(true);
  const before = heapStats();
  const mark = process.env.EE_MARK ? Bun.nanoseconds : () => 0;
  const start = clocks();
  mark();
  body();
  mark();
  const end = clocks();
  const after = heapStats();
  Bun.gc(true);
  const kept = heapStats();
  const types = {};
  for (const key of counted) types[key] = (after.objectTypeCounts[key] ?? 0) - (before.objectTypeCounts[key] ?? 0);
  line({
    kind: "cold",
    iters: 1,
    cpu_us: end[0] - start[0],
    thr_us: end[1] - start[1],
    retained_bytes: kept.heapSize - before.heapSize,
    retained_extra_bytes: kept.extraMemorySize - before.extraMemorySize,
    retained_objects: kept.objectCount - before.objectCount,
    types,
  });
}

if (NAME === "--list") {
  for (const [kind, table] of Object.entries({ hot, macro, cold })) for (const name in table) console.log(name + " " + kind);
  process.exit(0);
}
(async () => {
  if (hot[NAME]) await runHot(hot[NAME]);
  else if (macro[NAME]) await runMacro(macro[NAME]);
  else if (cold[NAME]) runCold(cold[NAME]);
  else {
    console.error("usage: ee-cases.js <case> [tier] [pre]   (ee-cases.js --list)");
    process.exit(2);
  }
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
