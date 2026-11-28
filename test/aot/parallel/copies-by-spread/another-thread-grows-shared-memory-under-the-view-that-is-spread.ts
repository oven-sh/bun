// Another thread lengthens the memory that a view follows while the view is spread: what is copied is as long as the view was when it was asked.
const rounds = 40;
if (Bun.isMainThread) {
  const flags = new Int32Array(new SharedArrayBuffer(8));
  const buffers = Array.from({ length: rounds }, () => new SharedArrayBuffer(3200, { maxByteLength: 1 << 20 }));
  const worker = new Worker(import.meta.url);
  worker.postMessage({ flags, buffers });
  const spread = (view: Int32Array) => [...view];
  const spreadBehind = (view: Int32Array) => [1, 2, ...view];
  const spreadNumbers = (view: Float64Array) => [0.5, ...view];
  let wrong = 0;
  for (let round = 0; round < rounds; round++) {
    const integers = new Int32Array(buffers[round]!);
    const numbers = new Float64Array(buffers[round]!);
    Atomics.store(flags, 0, round + 1);
    while (Atomics.load(flags, 1) <= round) {
      const lists = [spread(integers), spreadBehind(integers), spreadNumbers(numbers)];
      for (const list of lists) if (list.length < 400 || list.at(-1) !== 0) wrong++;
    }
  }
  console.log(wrong);
  worker.terminate();
} else {
  onmessage = ({ data: { flags, buffers } }: MessageEvent<{ flags: Int32Array; buffers: SharedArrayBuffer[] }>) => {
    for (let round = 0; round < buffers.length; round++) {
      while (Atomics.load(flags, 0) <= round);
      for (let turn = 0; turn < 2000 + round * 37; turn++) Atomics.load(flags, 0);
      buffers[round]!.grow(1 << 20);
      Atomics.store(flags, 1, round + 1);
    }
  };
}
