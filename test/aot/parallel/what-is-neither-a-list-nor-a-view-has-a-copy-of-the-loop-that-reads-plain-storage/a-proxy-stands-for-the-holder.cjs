// STATISTIC: OrdinaryObjectElementsReadDirectly >= 1
"use strict";
// The holder is a Proxy: every read of the length and of an element goes through its trap, in order.
const said = [];
function sum(like) { let s = 0; for (let j = 0; j < like.length; j++) s += like[j]; return s; }
function fresh() { return JSON.parse('{"length":4,"0":3,"1":5,"2":7,"3":9}'); }
for (let round = 0; round < 3; round++) {
    const log = []; const target = fresh();
    const proxy = new Proxy(target, { get(t, key, receiver) { log.push(String(key)); return key === "2" ? 1000 : Reflect.get(t, key, receiver); } });
    said.push(sum(target), sum(proxy), log.join(","));
    const bare = new Proxy(fresh(), {}); said.push(sum(bare));
    const revoked = Proxy.revocable(fresh(), {}); revoked.revoke(); try { sum(revoked.proxy); } catch (error) { said.push(error.name); }
}
console.log(said.join(" "));
