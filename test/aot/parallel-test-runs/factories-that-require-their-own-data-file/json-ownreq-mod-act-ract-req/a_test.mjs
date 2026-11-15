import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const show = it => it === null || typeof it !== "object" ? typeof it + " " + String(it).trim() : Object.keys(it).sort().join() + " " + [it.v, it.n, typeof it.default].join();
const say = (at, deed) => { let it; try { it = deed(); } catch (e) { it = "threw " + e.name; } if (it?.then) return it.then(x => console.log("SAID", at, show(x), globalThis.ran), e => console.log("SAID", at, "rejected " + e.name, globalThis.ran)); console.log("SAID", at, show(it), globalThis.ran); };
test("t", async () => {
  mock.module('./m.json', () => ({ ...req('./m.json'), v: 9 }));
  await say('act', () => vi.importActual('./m.json'));
  say('ract', () => jest.requireActual('./m.json'));
  say('req', () => req('./m.json'));
});
