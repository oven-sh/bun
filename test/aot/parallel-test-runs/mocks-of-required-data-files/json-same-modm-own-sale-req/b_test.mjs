import { jest, mock, test, vi } from "bun:test";
const show = it => { if (it === null || typeof it !== "object") return typeof it + " " + String(it).trim(); let d; try { d = JSON.stringify(it.default); } catch (e) { d = e.name; } return Object.keys(it).sort().join() + " " + [it.v, it.n].join() + " " + d; };
const say = (at, deed) => { let it; try { it = deed(); } catch (e) { it = 'threw ' + e.name; } if (it?.then) return it.then(x => console.log('SAID', at, show(x)), e => console.log('SAID', at, 'rejected ' + e.name)); console.log('SAID', at, show(it)); };
test("t", async () => {
  say('pre', () => require('./m.json'));
  mock.module("./m.json", () => { console.log("SAID factory"); return { ...require("./m.json"), v: 9 }; });
  await say('sale', async () => (await import('./sale.mjs')).sold());
  say('req', () => require('./m.json'));
});
