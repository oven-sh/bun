import { test, vi } from "bun:test";
let oils = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch (error) { return String(error.message).slice(0, 12); } };
test("a", async () => {
  console.log((await import("./stone.mjs")).stone);
  vi.doMock("./stone.mjs", () => ({ stone: "mocked" }));
  vi.doMock("./oil.mjs", async () => { oils++; await rest(15); throw new Error("oil fails " + oils); });
  console.log(asked("./flask.mjs"));
  vi.doUnmock("./stone.mjs");
  await rest(40);
  console.log(asked("./flask.mjs"), oils);
});
