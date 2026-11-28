// Another thread stores into shared memory while a view of it is spread: the elements of the list are numbers, whatever its bits were in between.
if (Bun.isMainThread) {
  const shared = new SharedArrayBuffer(512);
  const numbers = new Float64Array(shared);
  const started = new Int32Array(shared, 0, 1);
  const worker = new Worker(import.meta.url);
  worker.postMessage(shared);
  while (Atomics.load(started, 0) === 0);
  const spread = (view: Float64Array) => [...view];
  let others = 0;
  for (let turn = 0; turn < 300_000; turn++) {
    const list = spread(numbers);
    for (let place = 0; place < list.length; place++) if (typeof list[place] !== "number" || !(place in list)) others++;
  }
  console.log(others);
  worker.terminate();
} else {
  onmessage = ({ data }: MessageEvent<SharedArrayBuffer>) => {
    const words = new BigUint64Array(data);
    const started = new Int32Array(data, 0, 1);
    for (;;) {
      words[30] = 0xfffe000000000010n;
      Atomics.store(started, 0, 1);
      words[30] = 0x3ff0000000000000n;
    }
  };
}
