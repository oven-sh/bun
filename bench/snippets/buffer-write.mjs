import { group as suite, bench, run } from "mitata";

const bigBuf = Buffer.alloc(1024 * 256);
// Fill with letter "A" encoded as UTF16
for (let i = 0; i < bigBuf.length; i += 2) {
  bigBuf[i] = 65; // ASCII/UTF16 code for 'A'
  bigBuf[i + 1] = 0; // High byte for UTF16
}

var asUTF16LE = bigBuf.toString("utf16le");

// await run();
console.time("Buffer.from(bigBuf, 'utf16le')");
for (let i = 0; i < 100000; i++) {
  bigBuf.asciiWrite(asUTF16LE, 0, asUTF16LE.length);
}
console.timeEnd("Buffer.from(bigBuf, 'utf16le')");
