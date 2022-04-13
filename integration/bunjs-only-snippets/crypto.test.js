import { it, expect } from "bun:test";

for (let Hasher of [
  Bun.SHA1,
  Bun.SHA256,
  Bun.SHA384,
  Bun.SHA512,
  Bun.SHA512_256,
]) {
  it(`${Hasher.name} instance`, () => {
    var buf = new Uint8Array(256);
    const result = new Hasher();
    result.update("hello world");
    result.final(buf);
  });
}

for (let HashFn of [
  Bun.sha1,
  Bun.sha256,
  Bun.sha384,
  Bun.sha512,
  Bun.sha512_256,
]) {
  it(`${HashFn.name} instance`, () => {
    HashFn("hello world");
  });
}
