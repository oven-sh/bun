import { bench, run } from "mitata";
import { groupForEmitter } from "./implementations.mjs";

// Psuedo RNG is derived from https://stackoverflow.com/a/424445
let rngState = 123456789;
function nextInt() {
  const m = 0x80000000; // 2**31;
  const a = 1103515245;
  const c = 12345;
  rngState = (a * rngState + c) % m;
  return rngState;
}
function nextRange(start, end) {
  // returns in range [start, end): including start, excluding end
  // can't modulu nextInt because of weak randomness in lower bits
  const rangeSize = end - start;
  const randomUnder1 = nextInt() / 0x7fffffff; // 2**31 - 1
  return start + Math.floor(randomUnder1 * rangeSize);
}

const chunks = new Array(1024).fill(null).map((_, j) => {
  const arr = new Uint8Array(1024);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = nextRange(0, 256);
  }
  return arr;
});

groupForEmitter("stream simulation", ({ EventEmitter, name }) => {
  bench(name, () => {
    let id = 0;
    const stream = new EventEmitter();

    stream.on("start", res => {
      if (res.status !== 200) throw new Error("not 200");
    });

    const recived = [];
    stream.on("data", req => {
      recived.push(req);
    });

    stream.on("end", ev => {
      ev.preventDefault();
    });

    // simulate a stream
    stream.emit("start", { status: 200 });
    for (let chunk of chunks) {
      stream.emit("data", chunk);
    }
    stream.emit("end", {
      preventDefault() {
        id++;
      },
    });

    if (id !== 1) throw new Error("not implemented right");
    if (recived.length !== 1024) throw new Error("not implemented right");
  });
});

await run();
