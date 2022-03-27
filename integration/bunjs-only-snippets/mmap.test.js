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

it('mmap passed to other syscalls', async () => {
  const map = Bun.mmap(path);
  await Bun.write(path + '1', map);
  const text = await (await Bun.file(path + '1')).text();

  expect(text).toBe(new TextDecoder().decode(map));
});

it("mmap sync", async () => {
  const map = Bun.mmap(path);
  const map2 = Bun.mmap(path);

  const old = map[0];

  map[0] = 0;
  expect(map2[0]).toBe(0);

  map2[0] = old;
  expect(map[0]).toBe(old);

  await Bun.write(path, "olleh");
  expect(new TextDecoder().decode(map)).toBe("olleh");
});

it("mmap private", () => {
  const map = Bun.mmap(path, { shared: true });
  const map2 = Bun.mmap(path, { shared: false });

  const old = map[0];

  map2[0] = 0;
  expect(map2[0]).toBe(0);
  expect(map[0]).toBe(old);
});