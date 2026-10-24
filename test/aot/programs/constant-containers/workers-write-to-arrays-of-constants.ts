declare var self: Worker;
function numbers(): number[] { return [1, 2, 3]; }
function fractions(): number[] { return [0.5, 1.5]; }
function long(): number[] { return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]; }
function rows(): { k: number; v: number[] }[] { return [{ k: 1, v: [1, 2] }, { k: 2, v: [3, 4] }, { k: 3, v: [5, 6] }, { k: 4, v: [7, 8] }, { k: 5, v: [9, 10] }, { k: 6, v: [11, 12] }]; }
function work(tag: number): string {
  let sum = 0;
  for (let i = 0; i < 30000; i++) {
    const a = numbers(), b = fractions(), c = long(), r = rows();
    a[i % 3] += tag; b.push(tag); c.reverse(); r[i % 6].v[0] = tag;
    sum += a[0] + a[1] + a[2] + b.length + c[0] + r[i % 6].v[0] + numbers()[1] + long()[19] + rows()[5].v[1];
  }
  Bun.gc(true);
  return sum + " " + JSON.stringify([numbers(), fractions(), long(), rows()]);
}
if (Bun.isMainThread) {
  const workers = [1, 2, 3].map(tag => { const w = new Worker(import.meta.url); const done = new Promise<any>(resolve => { w.onmessage = e => resolve(e.data); }); w.postMessage({ tag, sent: numbers(), more: rows() }); return { w, done }; });
  const mine = work(10);
  const answers = await Promise.all(workers.map(x => x.done));
  for (const x of workers) x.w.terminate();
  console.log(mine); for (const a of answers) console.log(JSON.stringify(a));
} else {
  self.onmessage = (e: MessageEvent) => { e.data.sent.push(e.data.tag); e.data.more[0].v[1] = -1; postMessage({ echo: e.data, did: work(e.data.tag), fresh: numbers(), rows: rows()[0] }); };
}
