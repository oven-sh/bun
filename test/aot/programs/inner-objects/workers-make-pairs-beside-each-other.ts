declare var self: Worker;
interface Inner { d: number; e: number }
interface Outer { b: number; c: Inner }
function make(i: number): Outer { return { b: i, c: { d: i + 1, e: i + 2 } }; }
if (Bun.isMainThread) {
  const w = new Worker(import.meta.url);
  const got: any = await new Promise(resolve => { w.onmessage = e => resolve(e.data); w.postMessage({ whole: make(1), part: make(2).c }); });
  console.log(JSON.stringify(got));
  w.terminate();
} else {
  self.onmessage = (e: MessageEvent) => {
    const mine: Outer[] = []; for (let i = 0; i < 20000; i++) mine.push(make(i)); Bun.gc(true);
    let s = 0; for (const o of mine) s += o.c.d;
    postMessage({ echo: e.data, s, back: make(3), backPart: make(4).c });
  };
}
