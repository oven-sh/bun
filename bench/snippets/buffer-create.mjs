// @runtime bun,node,deno
import { Buffer } from "node:buffer";
import process from "node:process";
import { bench, run } from "../runner.mjs";

const N = parseInt(process.env.RUN_COUNTER ?? "10000", 10);
var isBuffer = new Buffer(0);
var isNOtBuffer = "not a buffer";

bench("Buffer.isBuffer(buffer)", () => {
  return Buffer.isBuffer(isBuffer);
});

{
  var j = 0;
  j += 1;
  j += eval("'ok'");

  bench("Buffer.isBuffer(string)", () => {
    return Buffer.isBuffer(j);
  });
}

bench("Buffer.from('short string')", () => {
  return Buffer.from("short string");
});

const loooong = "long string".repeat(9999).split("").join(" ");
bench("Buffer.byteLength('long string'.repeat(9999))", () => {
  return Buffer.byteLength(loooong);
});

var hundred = new ArrayBuffer(100);
bench("Buffer.from(ArrayBuffer(100))", () => {
  return Buffer.from(hundred);
});

var hundredArray = new Uint8Array(100);
bench("Buffer.from(Uint8Array(100))", () => {
  return Buffer.from(hundredArray);
});

var empty = new Uint8Array(0);
bench("Buffer.from(Uint8Array(0))", () => {
  return Buffer.from(empty);
});

bench("new Buffer(Uint8Array(0))", () => {
  return new Buffer(empty);
});

bench(`new Buffer(${N})`, () => {
  return new Buffer(N);
});

bench(`Buffer.alloc(${N})`, () => {
  return Buffer.alloc(N);
});

bench(`Buffer.allocUnsafe(${N})`, () => {
  return Buffer.allocUnsafe(N);
});

bench("Buffer.allocUnsafe(24_000)", () => {
  return Buffer.allocUnsafe(24_000);
});

bench("Buffer.alloc(24_000)", () => {
  return Buffer.alloc(24_000);
});

await run({});
