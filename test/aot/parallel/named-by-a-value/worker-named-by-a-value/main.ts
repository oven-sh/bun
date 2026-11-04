// Entry points: ./workers/a.ts ./workers/b.ts
const which = (globalThis as any).never ? "a" : "b";
const worker = new Worker(new URL("./workers/" + which + ".ts", import.meta.url).href);
worker.onmessage = event => { console.log(event.data); worker.terminate(); };
