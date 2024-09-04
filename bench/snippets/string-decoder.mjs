import { StringDecoder } from "string_decoder";
import { bench, run } from "./runner.mjs";

var short = Buffer.from("Hello World!");
var shortUTF16 = Buffer.from("Hello World 💕💕💕");
var long = Buffer.from("Hello World!".repeat(1024));
var longUTF16 = Buffer.from("Hello World 💕💕💕".repeat(1024));
bench(`${short.length} ascii`, () => {
  var decoder = new StringDecoder();
  decoder.write(short);
});

bench(`${short.length} utf8`, () => {
  var decoder = new StringDecoder();
  decoder.write(shortUTF16);
});

bench(`${long.length} ascii`, () => {
  var decoder = new StringDecoder();
  decoder.write(long);
});

bench(`${longUTF16.length} utf8`, () => {
  var decoder = new StringDecoder();
  decoder.write(longUTF16);
});

await run();
