// @runtime bun
import { ArrayBufferSink } from "bun";
import { bench, run } from "../runner.mjs";

var short = "Hello World!";
var shortUTF16 = "Hello World 💕💕💕";
var long = "Hello World!".repeat(1024);
var longUTF16 = "Hello World 💕💕💕".repeat(1024);
var encoder = new ArrayBufferSink({ stream: true, highWaterMark: 512 });

bench(`${short.length} ascii`, () => {
  encoder.write(short);
  encoder.start();
});

bench(`${short.length} utf8`, () => {
  encoder.write(shortUTF16);
  encoder.start();
});

bench(`${long.length} ascii`, () => {
  encoder.write(long);
  encoder.start();
});

bench(`${longUTF16.length} utf8`, () => {
  encoder.write(longUTF16);
  encoder.start();
});

await run();
