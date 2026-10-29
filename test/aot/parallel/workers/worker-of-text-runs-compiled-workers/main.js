// A compiled Worker and a Worker that starts from text answer in turns. Each kind starts the other.
// Entry points: ./known.js
const known = new URL("./known.js", import.meta.url).href;
const ask = (worker, message) =>
  new Promise((done, fail) => {
    worker.onmessage = (event) => done(event.data);
    worker.onerror = (event) => fail(new Error(event.message));
    worker.postMessage(message);
  });
const textOf = (code) => "data:text/javascript," + encodeURIComponent(code);
const compiled = new Worker(known);
let sum = await ask(compiled, 1);
const text = new Worker(
  textOf(
    "self.onmessage = e => postMessage(eval('e.data * 2') + Object.keys({ a: 1, ['key' + e.data]: 2 }).join('').length + new Function('n', 'return [n].map(String)[0].length')(e.data))",
  ),
);
for (let i = 0; i < 300; i++)
  sum += (await ask(compiled, i)) + (await ask(text, i));
console.log("sum", sum);
console.log(await ask(compiled, "start text"));
const starter = new Worker(
  textOf(
    `const inner = new Worker(${JSON.stringify(known)}); inner.onmessage = e => (inner.terminate(), postMessage("a compiled Worker below text: " + e.data)); inner.onerror = e => postMessage("error: " + e.message.slice(0, 80)); onmessage = e => inner.postMessage(e.data);`,
  ),
);
console.log(await ask(starter, 5));
const many = await Promise.all(
  Array.from({ length: 12 }, (_, i) => {
    const worker = new Worker(
      textOf("onmessage = e => postMessage(eval('e.data + 1'))"),
    );
    return ask(worker, i).finally(() => worker.terminate());
  }),
);
console.log(many.join());
for (const worker of [compiled, text, starter]) worker.terminate();
