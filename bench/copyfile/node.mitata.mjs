import { copyFileSync, statSync, writeFileSync } from "node:fs";
import { bench, run } from "../runner.mjs";

function runner(ready) {
  for (let size of [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000]) {
    const rand = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      rand[i] = (Math.random() * 1024 * 1024) | 0;
    }
    const dest = `/tmp/fs-test-copy-file-${((Math.random() * 10000000 + 100) | 0).toString(32)}`;
    const src = `/tmp/fs-test-copy-file-${((Math.random() * 10000000 + 100) | 0).toString(32)}`;
    writeFileSync(src, Buffer.from(rand.buffer), { encoding: "buffer" });
    const { size: fileSize } = statSync(src);
    if (fileSize !== rand.byteLength) {
      throw new Error("size mismatch");
    }
    ready(src, dest, new Uint8Array(rand.buffer));
  }
}
runner((src, dest, rand) =>
  bench(`copyFileSync(${rand.buffer.byteLength} bytes)`, () => {
    copyFileSync(src, dest);
    // const output = readFileSync(dest).buffer;

    // for (let i = 0; i < output.length; i++) {
    //   if (output[i] !== rand[i]) {
    //     throw new Error(
    //       "Files are not equal" + " " + output[i] + " " + rand[i] + " " + i
    //     );
    //   }
    // }
  }),
);
await run();
