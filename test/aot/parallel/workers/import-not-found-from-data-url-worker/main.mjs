// The code of a Worker made from a data: URL imports by a relative path and by a package name. Neither resolves from a data: URL,
// though a file of that name is part of the program. The error is the resolver's: a ResolveMessage.
import "./beside.mjs";
const ask = (what, worker) => new Promise(done => {
  worker.onmessage = event => { console.log(what + ":", JSON.stringify(event.data)); worker.terminate(); done(); };
});
await ask("import() of a relative path", new Worker('data:text/javascript,import("./beside.mjs").then(m => postMessage(m.beside), e => postMessage([e.name, e.code, e.constructor.name, Object.keys(e).join(), e.message.slice(0, 70), e.specifier, e.referrer.slice(0, 22)]))'));
await ask("import() of a package", new Worker('data:text/javascript,import("some-package").then(m => postMessage(m.default), e => postMessage([e.name, e.code, e.constructor.name, Object.keys(e).join(), e.message.slice(0, 70), e.specifier, e.referrer.slice(0, 22)]))'));
await ask("await import()", new Worker('data:text/javascript,try { postMessage((await import("./beside.mjs")).beside) } catch (e) { postMessage([e.name, e.code, e.constructor.name, Object.keys(e).join(), e.message.slice(0, 70), e.specifier, e.referrer.slice(0, 22)]) }'));
