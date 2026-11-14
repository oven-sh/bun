import { test, vi, mock, jest } from "bun:test";
const turns = async (count) => { for (let k = 0; k < count; k++) await new Promise((done) => setImmediate(done)); };
const short = (e) => "threw " + String(e.message).split("/").pop().slice(0, 40);
const told = (load) => { try { return String(load().seen ?? load().width); } catch (e) { return short(e); } };
const later = (load) => load().then((file) => String(file.seen ?? file.width), short);
let wick = 0, side = 0, openWick, failWick, openSide, openLater;
const wickGate = new Promise((done, fail) => { openWick = done; failWick = fail; });
const sideGate = new Promise((done) => { openSide = done; });
const laterGate = new Promise((done) => { openLater = done; });
const A = async () => { wick++; console.log("SAID A"); await wickGate; console.log("SAID A settles"); return { width: "first" }; };
const S = async () => { side++; console.log("SAID S"); await sideGate; console.log("SAID S settles"); return { depth: "works" }; };
const B = () => { wick++; console.log("SAID B " + wick); return { width: "later " + wick }; };
const calls = (when) => console.log("SAID " + when + " calls " + wick + " " + side);
const leave = () => { vi.doMock("./wick.mjs", A); vi.doMock("./side.mjs", S); console.log("SAID one " + told(() => require("./duo.mjs"))); };
const settleBoth = async () => { openSide(); await turns(3); calls("between"); openWick(); await turns(3); calls("then"); };
test("t", async () => {
  leave();
  vi.doMock("./wick.mjs", B);
  await turns(3);
  calls("at the end");
}, 8000);
test("u", async () => {
  console.log("SAID next " + await later(() => import("./duo.mjs")));
  calls("in the next test");
}, 8000);
