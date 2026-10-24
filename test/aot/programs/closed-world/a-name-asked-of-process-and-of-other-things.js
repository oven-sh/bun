// One name asked of process, whose prototype object defines it, and at the same place of primitives, instances, literals and a proxy.
import { EventEmitter } from "node:events";
const log = (...a) => console.log(a.map(String).join(" "));
log(1, [process, 1, "s", true, {}, [], () => 1].map(v => typeof v.on).join());
log(2, [process, 1, "s"].map(v => typeof v.emit + typeof v.listeners + typeof v.off).join());
class Mine { on() { return "mine"; } listenerCount() { return "many"; } } class Below extends Mine { }
log(3, [process, new Mine(), new Below(), new EventEmitter(), { on() { return "literal"; } }, Object.create({ on() { return "created"; } })].map(v => { const r = v.on("sfr2", () => { }); return r === v ? "itself" : r; }).join());
log(4, [process, new Mine(), new EventEmitter(), 5].map(v => v.listenerCount ? v.listenerCount("sfr2") : "none").join());
const parsed = JSON.parse('[{"on": 1}, 2, null]'); log(5, [process, ...parsed].map(v => v == null ? "null" : typeof v.on).join());
const deep = () => { let o = { on() { return "deep"; } }; for (let i = 0; i < 12; i++) o = Object.create(o); return o; }; log(6, [process, deep()].map(v => typeof v.on("sfr2b", () => { })).join());
const proxy = new Proxy({}, { get(t, k) { return () => "proxy " + String(k); } }); log(7, [process, proxy].map(v => typeof v.eventNames()).join());
const nul = Object.create(null); log(8, [process, nul].map(v => typeof v.once).join());
function pick(i) { return [process, "text", 7n, Symbol.iterator][i]; } for (let i = 0; i < 4; i++) log(9, typeof pick(i).getMaxListeners, typeof pick(i).constructor, pick(i).constructor === Object);
Object.setPrototypeOf(Below.prototype, process); log(10, typeof new Below().on, new Below().listenerCount("sfr2"), typeof new Below().pid);
