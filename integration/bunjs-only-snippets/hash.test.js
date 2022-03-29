import fs from "fs";
import { it, expect } from "bun:test";
import path from "path";

it(`Bun.hash()`, () => {
  console.log(Bun.hash("hello world"));
});
it(`Bun.hash.wyhash()`, () => {
  console.log(Bun.hash.wyhash("hello world"));
});
it(`Bun.hash.adler32()`, () => {
  console.log(Bun.hash.adler32("hello world"));
});
it(`Bun.hash.crc32()`, () => {
  console.log(Bun.hash.crc32("hello world"));
});
it(`Bun.hash.cityHash32()`, () => {
  console.log(Bun.hash.cityHash32("hello world"));
});
it(`Bun.hash.cityHash64()`, () => {
  console.log(Bun.hash.cityHash64("hello world"));
});
it(`Bun.hash.murmur32v3()`, () => {
  console.log(Bun.hash.murmur32v3("hello world"));
});
it(`Bun.hash.murmur64v2()`, () => {
  console.log(Bun.hash.murmur64v2("hello world"));
});
