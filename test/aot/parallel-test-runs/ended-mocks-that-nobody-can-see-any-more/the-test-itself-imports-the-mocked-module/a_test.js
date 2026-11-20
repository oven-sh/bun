import { test, vi } from "bun:test";
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
};
const held = refs => (refs.filter(ref => ref.deref() !== undefined).length <= 20 ? "few" : "many");
test("m6", async () => {
  const refs = [];
  const round = async () => {
    vi.resetModules();
    vi.doMock("./part.mjs", () => {
      const data = new Uint8Array(1 << 18).fill(1);
      refs.push(new WeakRef(data));
      return { data };
    });
    await import("./part.mjs");
    vi.doUnmock("./part.mjs");
  };
  for (let i = 0; i < 100; i++) await round();
  await settle();
  console.log("SAID m6", refs.length, held(refs));
}, 60000);
