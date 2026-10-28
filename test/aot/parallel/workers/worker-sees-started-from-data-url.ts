// What a Worker that starts from a data: URL sees of itself, and what it can import.
// Alone: which texts the build compiles for a Worker depends on what else the executable holds
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// STATISTIC: EngineRuns = 12
const ask = (url: string) =>
  new Promise<string>(done => {
    const worker = new Worker(url);
    worker.onmessage = event => (worker.terminate(), done(JSON.stringify(event.data)));
    worker.onerror = event => (worker.terminate(), done("error " + event.message.split("\n").find(line => /^\w*Error: /i.test(line))));
  });
console.log(await ask("data:text/javascript,postMessage([import.meta.url, import.meta.path, import.meta.dir, import.meta.file, import.meta.main, Bun.main, Bun.isMainThread, process.argv.length])"));
console.log(await ask("data:text/javascript,postMessage(new Error('x').stack.split('\\n').slice(1))"));
console.log(await ask("data:text/javascript,function f() { throw new TypeError('thrown in f') } f()"));
console.log(await ask("data:text/javascript,import { EOL } from 'node:os'; import path from 'node:path'; postMessage([EOL.length, path.basename('/a/b.c')])"));
console.log(await ask("data:text/javascript,const os = require('node:os'); postMessage([typeof os.cpus, typeof module, typeof exports, typeof require, typeof __filename, this === module.exports])"));
console.log(await ask("data:text/javascript,postMessage([typeof module, typeof require, (function () { return typeof this })()])"));
console.log(await ask("data:text/javascript,postMessage(await Promise.resolve('awaited at the top'))"));
console.log(await ask("data:text/javascript,import('node:fs').then(fs => postMessage(typeof fs.readFileSync))"));
console.log(await ask("data:text/javascript,class A { #p = 1; get p() { return this.#p } } enum E { a = 3 } postMessage([new A().p, E.a])"));
console.log(await ask("data:text/javascript,self.onmessage = null; postMessage([typeof self, typeof postMessage, self === globalThis, typeof close])"));
console.log(await ask("data:text/javascript,x = 1; postMessage(x)"));
