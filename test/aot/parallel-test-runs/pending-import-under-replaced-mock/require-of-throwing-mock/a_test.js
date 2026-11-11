import { test, vi } from "bun:test";
const word = (load, name) => Promise.resolve(load).then(it => String(typeof it[name] === "function" ? it[name]() : it[name]), error => error.constructor.name + ": " + error.message.replace(/"[^"]*"/, "the file").slice(0, 34));
const bounded = said => Promise.race([said, Promise.resolve().then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => "still waiting")]);
const asked = name => { try { return require(name); } catch (error) { return Promise.reject(error); } };
test("t", async () => {
  let calls = 0;
  const answer = Promise.withResolvers(), called = Promise.withResolvers();
  vi.doMock("./m.js", () => { called.resolve(); return answer.promise; });
  const first = word(import("./m.js"), "x");
  await called.promise;
  vi.doMock("./m.js", () => { calls++; throw new RangeError("no answer"); });
  const go = () => asked("./m.js");
  const second = word(answer.promise.then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(go, go), "x");
  answer.resolve({ x: "old x" });
  const one = await bounded(first), two = await bounded(second);
  console.log("SAID 12", one, "|", two, "|", await bounded(word(import("./m.js"), "x")), calls, globalThis.ran ?? "-");
});
