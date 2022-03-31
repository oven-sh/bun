import fs from "fs";
import { it, expect } from "bun:test";
import path from "path";

it(`Bun.hash()`, () => {
  Bun.hash("hello world");
  Bun.hash(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.wyhash()`, () => {
  Bun.hash.wyhash("hello world");
  Bun.hash.wyhash(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.adler32()`, () => {
  Bun.hash.adler32("hello world");
  Bun.hash.adler32(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.crc32()`, () => {
  Bun.hash.crc32("hello world");
  Bun.hash.crc32(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.cityHash32()`, () => {
  Bun.hash.cityHash32("hello world");
  Bun.hash.cityHash32(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.cityHash64()`, () => {
  Bun.hash.cityHash64("hello world");
  Bun.hash.cityHash64(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.murmur32v3()`, () => {
  Bun.hash.murmur32v3("hello world");
  Bun.hash.murmur32v3(new TextEncoder().encode("hello world"));
});
it(`Bun.hash.murmur64v2()`, () => {
  Bun.hash.murmur64v2("hello world");
  Bun.hash.murmur64v2(new TextEncoder().encode("hello world"));
});
