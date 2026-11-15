import { test, vi } from "bun:test";
const tell = (name, deed) => { try { console.log("SAID", name, deed()); } catch (error) { console.log("SAID", name, "threw", String(error.message).split("\n")[0]); } };
test("the barrel before and behind the run of the mock", async () => {
  console.log("SAID sign", (await import("tray/sign.mjs")).sign);
  vi.doMock("tray/cups.mjs", () => ({ rim: 10 }));
  const user = await import("./user.mjs");
  tell("first", user.look);
  console.log("SAID the mock", (await import("tray/cups.mjs")).rim);
  tell("then", user.look);
});
