import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

const bigBuffer = Buffer.from("hello world".repeat(10000));
const converted = bigBuffer.toString("base64");
const uuid = crypto.randomBytes(16);

bench(`Buffer(${bigBuffer.byteLength}).toString('base64')`, () => {
  return bigBuffer.toString("base64");
});

bench(`Buffer(${uuid.byteLength}).toString('base64')`, () => {
  return uuid.toString("base64");
});

bench(`Buffer(${bigBuffer.byteLength}).toString('base64url')`, () => {
  return bigBuffer.toString("base64url");
});

bench(`Buffer(${uuid.byteLength}).toString('base64url')`, () => {
  return uuid.toString("base64url");
});

bench(`Buffer(${bigBuffer.byteLength}).toString('hex')`, () => {
  return bigBuffer.toString("hex");
});

bench(`Buffer(${uuid.byteLength}).toString('hex')`, () => {
  return uuid.toString("hex");
});

bench(`Buffer(${bigBuffer.byteLength}).toString('ascii')`, () => {
  return bigBuffer.toString("ascii");
});

await run();
