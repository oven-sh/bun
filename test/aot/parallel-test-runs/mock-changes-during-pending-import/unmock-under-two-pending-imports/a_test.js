import { test, vi, mock, jest } from "bun:test";
const M = "./module.mjs";
const read = it => { try { return String(it.early); } catch (error) { return "threw " + error.name; } };
const settle = async it => { try { return read(await it); } catch (error) { return "rejected " + error.name; } };
const ask = () => { try { return read(require(M)); } catch (error) { return "threw " + error.name; } };
test("t", async () => {
  vi.doMock(M, () => ({ early: "mock 1" }));
  const one = await import(M);
  console.log("SAID one", read(one));
  const third = import(M);
  const fourth = import(M);
  vi.doUnmock(M);
  const joiner = import(M);
  console.log("SAID third", await settle(third), "| fourth", await settle(fourth), "| held", read(one));
  console.log("SAID joiner", await settle(joiner));
  console.log("SAID at the end: third", await settle(third), "| held", read(one), "| anew", await settle(import(M)), "| ran", globalThis.ran ?? 0);
}, 9000);
