import { jest, mock, test, vi } from "bun:test";
const show = it => it === null || typeof it !== "object" ? typeof it + " " + String(it).trim() : Object.keys(it).sort().join() + " " + [it.v, it.n, typeof it.default].join();
const say = (at, deed) => { let it; try { it = deed(); } catch (e) { it = 'threw ' + e.name; } if (it?.then) return it.then(x => console.log('SAID', at, show(x)), e => console.log('SAID', at, 'rejected ' + e.name)); console.log('SAID', at, show(it)); };
test("t", async () => {
  mock.module("./m.json", () => ({ ...require("./m.json"), v: 9 }));
  say('ract', () => jest.requireActual('./m.json'));
  await say('imp', () => import('./m.json'));
});
