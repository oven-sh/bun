import { bench, run } from "../runner.mjs";

var short = "Hello World!";
var shortUTF16 = "Hello World 💕💕💕";
var long = "Hello World!".repeat(1024);
var longUTF16 = "Hello World 💕💕💕".repeat(1024);
var encoder = new TextEncoder();

bench(`4 ascii`, () => {
  encoder.encode("heyo");
});

bench(`4 utf8`, () => {
  encoder.encode("💕💕");
});

bench(`${short.length} ascii`, () => {
  encoder.encode(short);
});

bench(`${short.length} utf8`, () => {
  encoder.encode(shortUTF16);
});

bench(`${long.length} ascii`, () => {
  encoder.encode(long);
});

bench(`${longUTF16.length} utf8`, () => {
  encoder.encode(longUTF16);
});

await run();
