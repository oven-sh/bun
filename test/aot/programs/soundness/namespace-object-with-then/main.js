import * as ns from "./thenable.js";
async function give() { return ns; }
console.log("await", typeof (await ns));
console.log("resolve", typeof (await Promise.resolve(ns)));
console.log("async function", typeof (await give()));
console.log("all", typeof (await Promise.all([ns]))[0]);
console.log("calls", ns.calls());
