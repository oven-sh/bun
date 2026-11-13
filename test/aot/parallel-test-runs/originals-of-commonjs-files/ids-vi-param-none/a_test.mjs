import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
vi.mock("./tax.cjs", async o => ({ ...(await o()), rate: 9 }));
const require = createRequire(import.meta.url);
const call = async deed => { try { return String(await deed()); } catch (error) { return "threw " + error.name; } };
const safe = async deed => { try { return await deed(); } catch (error) { return { rate: "threw " + error.name + " " + error.message.slice(0, 12) }; } };
async function say(name, it) {
  if (it?.then) it = await it;
  console.log("SAID", name, await call(() => Object.keys(it).sort().join()), await call(() => it.rate), await call(() => it.fee()), await call(() => it.show()), await call(() => it.default?.fee?.()), await call(() => it.early));
}
test("a", async () => {
  await say("mocked", await safe(() => import("./tax.cjs")));
  await say("required", await safe(() => require("./tax.cjs")));
  console.log("SAID user", await call(async () => (await import("./user.mjs")).used()), await call(() => require("./user.cjs").used()));
  const actual = await safe(() => vi.importActual("./tax.cjs"));
  await say("actual", actual);
  const own = await safe(() => jest.requireActual("./tax.cjs"));
  await say("actual required", own);
  console.log("SAID same", actual === (await safe(() => vi.importActual("./tax.cjs"))), own === (await safe(() => jest.requireActual("./tax.cjs"))), actual?.fee === own?.fee);
  
});
