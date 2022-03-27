import { describe, it, expect } from "bun:test";

const path = `/tmp/bun-mmap-test_${Math.random()}.txt`;

await Bun.write(path, "hello");

it("mmap finalizer", async () => {
  let map = Bun.mmap(path);
  const map2 = Bun.mmap(path);

  map = null;
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 1));
});

it("mmap sync", () => {
  let map = Bun.mmap(path);
  const map2 = Bun.mmap(path);

  const old = map[0];

  map[0] = 0;
  expect(map2[0]).toBe(0);

  map2[0] = old;
  expect(map[0]).toBe(old);
});

it("mmap private", () => {
  const map = Bun.mmap(path, { shared: true });
  const map2 = Bun.mmap(path, { shared: false });

  const old = map[0];

  map2[0] = 0;
  expect(map2[0]).toBe(0);
  expect(map[0]).toBe(old);
});