import { test, vi, jest } from "bun:test";
import reader from "./reader.cjs";
const read = () => reader.read();
test("a", async () => {
  vi.doMock("./unit.cjs", async original => ({ ...(await original()), kept: "mock" }));
  const seen = [];
  try { const got = jest.requireActual("./unit.cjs"); seen.push(got?.token ?? got?.default?.token); } catch (error) { seen.push(error === globalThis.error ? "its error" : error.name); }
  try { const got = read(); seen.push(got?.token ?? got?.default?.token); } catch (error) { seen.push(error === globalThis.error ? "its error" : error.name); }
  const first = seen.find(it => typeof it === "object");
  console.log("SAID", (globalThis.runs ?? []).join(), seen.map(it => typeof it === "object" ? (it === first ? "first" : "another") : String(it)).join());
});
