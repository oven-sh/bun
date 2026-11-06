// The entry point's default export may be the configuration of a server: the run time reads `fetch`, `app` and `stop` on it and hands it to
// Bun.serve. The members are data, methods or getters that print and store through `this`; they stand on the object, on a class, on a base class
// or on an object above it, or behind a Proxy that prints each read. The export is written in many ways. A server that starts is asked once.
import type { Random } from "./random";

interface Member {
  name: string;
  kind: "data" | "method" | "getter" | "accessors";
  text: string;
}

const fetches: readonly (Member | undefined)[] = [
  { name: `fetch`, kind: `method`, text: `fetch() {\nreturn new Response("served");\n}` },
  { name: `fetch`, kind: `method`, text: `fetch() {\nreturn new Response("served");\n}` },
  { name: `fetch`, kind: `method`, text: `async fetch(request) {\nreturn new Response("served " + new URL(request.url).pathname);\n}` },
  { name: `fetch`, kind: `method`, text: `fetch(request, server) {\nreturn new Response("served " + typeof this + " " + (this === server) + " " + reads);\n}` },
  { name: `fetch`, kind: `data`, text: `() => new Response("served by an arrow")` },
  { name: `fetch`, kind: `data`, text: `function () {\nreturn new Response("served by a function " + reads);\n}` },
  { name: `fetch`, kind: `getter`, text: `get fetch() {\nsay("fetch is read");\nreturn () => new Response("served by what the getter made");\n}` },
  { name: `fetch`, kind: `getter`, text: `get fetch() {\nsay("fetch is read");\nreturn undefined;\n}` },
  { name: `fetch`, kind: `getter`, text: `get fetch() {\nsay("fetch is read");\nthrow new RangeError("from fetch");\n}` },
  { name: `fetch`, kind: `data`, text: `7` },
  undefined,
];
const stops: readonly (Member | undefined)[] = [
  undefined,
  undefined,
  { name: `stop`, kind: `getter`, text: `get stop() {\nsay("stop is read on " + (this?.constructor?.name ?? typeof this));\nreturn undefined;\n}` },
  { name: `stop`, kind: `getter`, text: `get stop() {\nsay("stop is read");\nreturn () => {};\n}` },
  { name: `stop`, kind: `getter`, text: `get stop() {\nsay("stop is read");\nthis.mark = "stored by stop";\nreturn null;\n}` },
  { name: `stop`, kind: `getter`, text: `get stop() {\nsay("stop is read");\nthrow new RangeError("from stop");\n}` },
  { name: `stop`, kind: `getter`, text: `get stop() {\nsay("stop is read");\nheld.push({ kept: reads });\nreturn held.length > 1 ? () => {} : 0;\n}` },
  {
    name: `stop`,
    kind: `accessors`,
    text: `get stop() {\nsay("stop is read");\nreturn this.stopped;\n}\nSEPARATOR\nset stop(value) {\nsay("stop is stored");\nthis.stopped = value;\n}`,
  },
  { name: `stop`, kind: `method`, text: `stop() {\nsay("stop is called");\n}` },
  { name: `stop`, kind: `data`, text: `7` },
  { name: `stop`, kind: `data`, text: `undefined` },
  { name: `stop`, kind: `data`, text: `class {}` },
];
const apps: readonly (Member | undefined)[] = [
  undefined,
  undefined,
  undefined,
  undefined,
  { name: `app`, kind: `data`, text: `undefined` },
  { name: `app`, kind: `data`, text: `null` },
  { name: `app`, kind: `getter`, text: `get app() {\nsay("app is read");\nreturn undefined;\n}` },
  { name: `app`, kind: `getter`, text: `get app() {\nsay("app is read");\nreturn null;\n}` },
];
const more: readonly Member[] = [
  { name: `routes`, kind: `data`, text: `{ "/": new Response("from a route") }` },
  { name: `routes`, kind: `data`, text: `{ "/": () => new Response("from a function of a route") }` },
  { name: `routes`, kind: `getter`, text: `get routes() {\nsay("routes is read");\nreturn { "/": new Response("from a route that a getter made") };\n}` },
  { name: `then`, kind: `method`, text: `then(resolve) {\nsay("then is called " + typeof resolve);\nif (typeof resolve === "function") resolve(1);\n}` },
  { name: `then`, kind: `getter`, text: `get then() {\nsay("then is read");\nreturn undefined;\n}` },
  { name: `error`, kind: `method`, text: `error(error) {\nreturn new Response("the handler got " + error.name);\n}` },
  { name: `development`, kind: `data`, text: `false` },
  { name: `development`, kind: `getter`, text: `get development() {\nsay("development is read");\nreturn false;\n}` },
  { name: `hostname`, kind: `data`, text: `"127.0.0.1"` },
  { name: `hostname`, kind: `getter`, text: `get hostname() {\nsay("hostname is read");\nreturn "127.0.0.1";\n}` },
  { name: `idleTimeout`, kind: `data`, text: `30` },
  { name: `id`, kind: `getter`, text: `get id() {\nsay("id is read");\nreturn undefined;\n}` },
  { name: `websocket`, kind: `data`, text: `{ message() {} }` },
  { name: `mark`, kind: `data`, text: `"first"` },
];
const ports: readonly Member[] = [
  { name: `port`, kind: `data`, text: `0` },
  { name: `port`, kind: `data`, text: `0` },
  { name: `port`, kind: `data`, text: `"0"` },
  { name: `port`, kind: `getter`, text: `get port() {\nsay("port is read");\nreturn 0;\n}` },
];

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

const inLiteral = (member: Member) => (member.kind === `data` ? `${member.name}: ${member.text},` : member.text.replace(`\nSEPARATOR`, `,`) + `,`);
const inClass = (member: Member) => (member.kind === `data` ? `${member.name} = ${member.text};` : member.text.replace(`\nSEPARATOR`, ``));
const literal = (members: readonly Member[]) => `{\n${members.map(inLiteral).join("\n")}\n}`;

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const members = [pick(random, ports), pick(random, fetches), pick(random, stops), pick(random, apps)].filter(member => member !== undefined);
  for (let count = random.below(4); count > 0; count--) {
    const member = pick(random, more);
    if (!members.some(other => other.name === member.name)) members.push(member);
  }
  for (let index = members.length - 1; index > 0; index--) {
    const other = random.below(index + 1);
    [members[index], members[other]] = [members[other], members[index]];
  }
  const above = members.filter(() => random.chance(0.4));
  const own = members.filter(member => !above.includes(member));

  // Object.assign copies what a getter returns, so these take data and methods alone; the port stays 0.
  const plainOf = (list: readonly Member[], others: readonly Member[]) => {
    const kept = list.filter(member => member.kind === `data` || member.kind === `method`);
    return [...kept, ...others].some(member => member.name === `port`) ? kept : [...kept, ports[0]];
  };
  const makers = [
    () => [`const config = ${literal(members)};`],
    () => [`class Config {\n${members.map(inClass).join("\n")}\n}`, `const config = new Config();`],
    () => [`class Base {\n${above.map(inClass).join("\n")}\n}`, `class Config extends Base {\n${own.map(inClass).join("\n")}\n}`, `const config = new Config();`],
    () => [`const config = Object.assign(Object.create(${literal(above)}), ${literal(plainOf(own, above))});`],
    () => [`const config = { __proto__: ${literal(above)}, ${literal(own).slice(1)};`],
    () => [`const config = ${literal(own)};`, `LATER Object.setPrototypeOf(config, ${literal(above)});`],
    () => [`const config = Object.freeze(${literal(members)});`],
    () => [`const config = Object.assign(function config() {}, ${literal(plainOf(members, []))});`],
    () => [`const config = { __proto__: null, ${literal(members).slice(1)};`],
    () => [
      `const config = new Proxy(${literal(members)}, {\nget(target, key, receiver) {\nsay("get " + String(key));\nreturn Reflect.get(target, key, receiver);\n},\nhas(target, key) {\nsay("has " + String(key));\nreturn Reflect.has(target, key);\n},\n});`,
    ],
    () => [`const config = new (class Config {\nstatic made = 0;\nconstructor() {\nConfig.made++;\n}\n${members.map(inClass).join("\n")}\n})();`],
  ];
  const made = pick(random, makers)();
  const now = made.filter(line => !line.startsWith(`LATER `));
  const later = made.filter(line => line.startsWith(`LATER `)).map(line => line.slice(6));

  const head = [
    `let reads = 0;`,
    `const held = [];`,
    `function say(line) {\nreads++;\nconsole.log(line);\n}`,
    `console.debug = line => {\nconsole.log("debug", String(line).replace(/\\d+\\/?$/, "PORT"));\nfetch(String(line).slice(String(line).indexOf("http"))).then(\nasync response => {\nconsole.log(response.status, await response.text(), reads, held.length);\nprocess.exit(0);\n},\nerror => {\nconsole.log("the request failed", error.name);\nprocess.exit(0);\n},\n);\n};`,
    `process.on("exit", code => console.log("the end", code, reads));`,
    `setTimeout(() => {\nconsole.log("nobody answered");\nprocess.exit(0);\n}, 20000).unref();`,
  ];
  const files: Record<string, string> = {};
  const way = random.below(12);
  const join = (lines: readonly string[]) => lines.join("\n") + "\n";
  switch (way) {
    case 0:
    case 1:
    case 2:
      return { file: pick(random, [`main.js`, `main.mjs`, `main.ts`]), text: join([`// @ts-nocheck`, ...head, ...now, `export default config;`, ...later]), files };
    case 3:
      return { file: `main.mjs`, text: join([...head, ...now, `export { config as default };`, ...later]), files };
    case 4:
      return { file: `main.cjs`, text: join([...head, ...now, `module.exports = config;`, ...later]), files };
    case 5:
      return { file: `main.cjs`, text: join([...head, ...now, `exports.default = config;`, ...later]), files };
    case 6:
      return { file: `main.mjs`, text: join([...head, ...now, `await 0;`, `say("behind the await");`, `export default config;`, ...later]), files };
    case 7:
      return { file: `main.mjs`, text: join([...head, ...now, `export default await Promise.resolve().then(() => config);`, ...later]), files };
    case 8:
      files[`config.mjs`] = join([`function say(line) {\nglobalThis.say(line);\n}`, `const held = [];`, `let reads = 0;`, ...now, `export default config;`, ...later]);
      return { file: `main.mjs`, text: join([...head, `globalThis.say = say;`, `export { default } from "./config.mjs";`]), files };
    case 9:
      return {
        file: `main.mjs`,
        text: join([...head, ...now, `let current = { port: 0, stop() {} };`, `export { current as default };`, `current = config;`, ...later]),
        files,
      };
    case 10:
      return { file: `main.mjs`, text: join([...head, ...now, `export default config;`, `export const fetch = 7;`, `export function stop() {}`, ...later]), files };
    default:
      return { file: `main.mjs`, text: join([...head, ...now, `export default () => config;`, `export { config };`, ...later]), files };
  }
}
