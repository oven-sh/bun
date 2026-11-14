import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const require = req;
const show = it => it === null || typeof it !== "object" ? typeof it + " " + String(it).trim() : Array.isArray(it) ? "list " + it : Object.keys(it).sort().join() + " " + [it.v, typeof it.default].join();
const say = (at, deed) => { let it; try { it = deed(); } catch (e) { it = "threw " + e.name; } if (it?.then) return it.then(x => console.log("SAID", at, show(x)), e => console.log("SAID", at, "rejected " + e.name)); console.log("SAID", at, show(it)); };
test("t", async () => {
  mock.module('./m.json', async o => ({ ...(await o()), v: 9 }));
  say('lit', () => require('./m.json'));
  say('ract', () => jest.requireActual('./m.json'));
  await say('imp', () => import('./m.json'));
});
