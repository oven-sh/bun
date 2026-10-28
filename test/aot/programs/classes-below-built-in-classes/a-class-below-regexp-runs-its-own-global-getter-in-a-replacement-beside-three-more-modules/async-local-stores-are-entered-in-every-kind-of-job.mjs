import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { stat } from "node:fs";
import { createServer } from "node:http";
const lines = [];
const kept = [];
const emitter = new EventEmitter();
let first = undefined;
let second = undefined;
const see = label => lines.push(label + " " + first?.getStore() + " " + second?.getStore());
async function ask(handle) {
const server = Bun.serve({
port: 0,
async fetch() {
await handle();
return new Response("answer");
},
});
await (await fetch(server.url)).text();
see("behind a request");
await (await fetch(server.url)).text();
await server.stop(true);
}
async function askNode(handle) {
const server = createServer((request, response) => {
handle();
response.end("answer");
});
await new Promise(resolve => server.listen(0, resolve));
await (await fetch("http://127.0.0.1:" + server.address().port)).text();
see("behind a request");
await new Promise(resolve => {
server.close(resolve);
server.closeAllConnections();
});
}
(second ??= new AsyncLocalStorage()).run("s1", () => {
see("s3");
see("s4");
});
kept.shift()?.(() => {
kept.push(AsyncLocalStorage.bind(run => run()));
see("s7");
});
see("s9");
see("s10");
await (async () => {
await new Promise(resolve => setTimeout(() => {
[1].forEach(() => {
Promise.resolve().then(() => {
first?.enterWith("s11");
(second ??= new AsyncLocalStorage()).exit(() => {
first ??= new AsyncLocalStorage();
see("s15");
});
see("s16");
});
see("s18");
Promise.resolve().finally(() => {
Promise.resolve().then(() => {
see("s20");
see("s21");
});
see("s22");
});
see("s23");
});
Promise.resolve({ then(resolve) {
second?.enterWith("s24");
see("s26");
resolve();
} });
second?.disable();
see("s29");
resolve();
}, 0));
(second ??= new AsyncLocalStorage()).run("s30", () => {
kept.shift()?.(() => {
queueMicrotask(() => {
Promise.reject(1).catch(() => {
second?.disable();
see("s33");
});
first?.enterWith("s34");
(second ??= new AsyncLocalStorage()).run("s36", () => {
see("s38");
see("s39");
});
see("s40");
});
see("s41");
});
see("s42");
});
first?.disable();
see("s45");
})();
see("behind everything");
await new Promise(resolve => setTimeout(resolve, 5));
see("at the end");
console.log(lines.join("\n"));
