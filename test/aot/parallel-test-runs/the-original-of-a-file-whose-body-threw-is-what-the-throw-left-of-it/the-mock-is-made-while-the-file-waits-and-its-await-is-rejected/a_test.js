import { test, mock, jest, spyOn } from "bun:test";
const show = read => { try { return String(read()); } catch (error) { return error.name; } };
const look = actual => [show(() => typeof actual.f), show(() => actual.a), show(() => actual.b), show(() => actual.f()), show(() => Object.keys({ ...actual }).join())].join(" ");
const load = () => import("./lib.mjs").then(() => "ran", error => error.name);
const original = () => { try { return look(jest.requireActual("./lib.mjs")); } catch (error) { return "refused " + error.name; } };
test("t", async () => {
  const waiting = load();
  mock.module("./lib.mjs", () => ({ a: 10 }));
  console.log("SAID while it waits", original());
  console.log("SAID first", await waiting);
  console.log("SAID original", original());
});
