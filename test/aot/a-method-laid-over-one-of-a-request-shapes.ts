// Every shape is a server whose requests are made by a constructor function of the program that inherits from http.IncomingMessage.
// Another file lays a function over `push` on that function's prototype, each shape in a way of its own, and node:http has to call
// what was laid. The shape prints how often it was called.
export type Shape = { name: string; files: Record<string, string> };

const heirs = {
  "util.inherits": "util.inherits(Ask, http.IncomingMessage);",
  "Object.setPrototypeOf":
    "Object.setPrototypeOf(Ask.prototype, http.IncomingMessage.prototype); Object.setPrototypeOf(Ask, http.IncomingMessage);",
  "Object.create": "Ask.prototype = Object.create(http.IncomingMessage.prototype);",
};

const lays = [
  "Ask.prototype.push = o;",
  "Object.assign(Ask.prototype, { push: o });",
  "util._extend(Ask.prototype, { push: o });",
  "Reflect.set(Ask.prototype, 'push', o);",
  "Object.defineProperty(Ask.prototype, 'push', { value: o, configurable: true, writable: true });",
  "Object.defineProperties(Ask.prototype, { push: { value: o, configurable: true, writable: true } });",
  "for (const [key, value] of Object.entries({ push: o })) Ask.prototype[key] = value;",
  "const from = { push: o }; for (const key of Object.keys(from)) Ask.prototype[key] = from[key];",
  "Ask.prototype['' + unseen('push')] = o;",
  "Ask.prototype.__defineGetter__('push', () => o);",
  "Object.defineProperty(Ask.prototype, 'push', { configurable: true, get: () => o });",
  "const held = Ask.prototype; held.push = o;",
];

const moments = [
  "lay(util.deprecate(wrap, 'm'));",
  "server.once('request', () => {}); lay(util.deprecate(wrap, 'm'));",
  "server.on('connection', () => { if (!laid) { laid = true; lay(util.deprecate(wrap, 'm')); } });",
];

export function shapes(): Shape[] {
  return Object.entries(heirs).flatMap(([heir, inherits]) =>
    lays.map((lay, at) => ({
      name: `${heir}; ${lay}`,
      files: {
        "other.mjs": `import http from "node:http"; import util from "node:util"; export const unseen = x => [x][JSON.parse("0")];
export function Ask(...given) { http.IncomingMessage.apply(this, given); } ${inherits}
export function lay(o) { ${lay} }
`,
        "main.mjs": `import http from "node:http"; import util from "node:util"; import { lay, Ask } from "./other.mjs";
let calls = 0, laid = false; const real = http.IncomingMessage.prototype.push;
const wrap = function (...given) { calls++; return real.apply(this, given); };
const server = http.createServer({ IncomingMessage: Ask }, (req, res) => { req.on("data", () => {}); req.on("end", () => { res.setHeader("a", "b"); res.write("c"); res.end("x"); }); });
${moments[at % moments.length]}
server.listen(0, () => { const client = http.request({ port: server.address().port, method: "POST", agent: false }, answer => { answer.resume(); answer.on("end", () => { console.log("called", calls); process.exit(0); }); }); client.on("error", () => { console.log("client error", calls); process.exit(0); }); client.end("body"); });
`,
      },
    })),
  );
}
