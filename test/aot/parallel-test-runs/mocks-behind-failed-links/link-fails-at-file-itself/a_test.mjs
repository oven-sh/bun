import { test, vi, jest, mock } from "bun:test";
test("asks", async () => {
  const said = [];
  const words = m => Object.keys(m).map(k => { try { return k + "=" + m[k]; } catch (error) { return k + "!" + error.name; } }).join();
  const say = async name => { try { said.push(name.slice(2, -4) + ": " + words(await import(name))); } catch (error) { said.push(name.slice(2, -4) + "! " + error.name); } };
  const sayRequired = name => { try { said.push(name.slice(2, -4) + ": " + words(require(name))); } catch (error) { said.push(name.slice(2, -4) + "! " + error.name); } };
  await say("./user.mjs");
  jest.doMock("./dep.mjs", () => ({ a: "mocked", extra: "extra" }));
  await say("./user.mjs"); await say("./barrel.mjs");
  console.log(said.join(" | "), JSON.stringify(globalThis.runs));
});
