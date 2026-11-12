// With node:net alone, Readable.prototype has no map(), filter() and so on. They arrive with all of node:stream, which the first pipe() that looks at
// process.stdout loads. Each way is a process of its own.
const ways = {
  "nothing"() {},
  "console.log"() {
    console.log("");
  },
  "process.stdout"() {
    void process.stdout;
  },
  "process.stderr"() {
    void process.stderr;
  },
  "node:fs"() {
    require("node:fs");
  },
  "node:http"() {
    require("node:http");
  },
  "pipe"(net) {
    new net.Socket().pipe(new net.Socket());
  },
  "pipe, end: false"(net) {
    new net.Socket().pipe(new net.Socket(), { end: false });
  },
  "pipe, end: true"(net) {
    new net.Socket().pipe(new net.Socket(), { end: true });
  },
  "pipe twice"(net) {
    const source = new net.Socket();
    source.pipe(new net.Socket(), { end: false });
    source.pipe(new net.Socket());
  },
  "pipe, both replaced"(net) {
    Object.defineProperty(process, "stdout", { value: 1, configurable: true });
    Object.defineProperty(process, "stderr", { value: 2, configurable: true });
    new net.Socket().pipe(new net.Socket());
  },
  "pipe to a replaced stdout"(net) {
    const destination = new net.Socket();
    Object.defineProperty(process, "stdout", { value: destination, configurable: true });
    new net.Socket().pipe(destination);
  },
};
const way = process.env.WAY_TO_THE_OPERATORS;
if (way === undefined) {
  const { spawnSync } = require("node:child_process");
  const command = /[$~]bun/i.test(process.argv[1]) ? [] : [process.argv[1]];
  for (const name of Object.keys(ways)) {
    const { stdout, status } = spawnSync(process.execPath, command, {
      encoding: "utf8",
      env: { ...process.env, WAY_TO_THE_OPERATORS: name },
    });
    console.log(name + ": " + stdout.trim().split("\n").at(-1) + " " + status);
  }
} else {
  const net = require("node:net");
  const prototype = Object.getPrototypeOf(Object.getPrototypeOf(net.Socket.prototype));
  const before = typeof prototype.map;
  ways[way](net);
  const names = Object.getOwnPropertyNames(prototype);
  require("node:fs").writeSync(
    1,
    [before, typeof prototype.map, typeof new net.Socket().toArray, names.length, names.slice(-11).join()].join(" ") +
      "\n",
  );
  process.exit(0);
}
