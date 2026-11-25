// what cannot be called is handed to a loop that calls it in every turn: the arguments are evaluated first, the TypeError comes in the first turn, and never without one
let log = "";
function each(cb: any, n: number) { for (let i = 0; i < n; i++) cb((log = log + "a" + i)); return log; }
function deed(cb: unknown, n: number) { log = ""; try { return each(cb, n); } catch (e) { return (e as Error).name + " " + log; } }
class Made {}
const revoked = Proxy.revocable(() => {}, {});
revoked.revoke();
console.log(deed(() => {}, 2));
for (let turn = 0; turn < 300; turn++) deed(() => {}, 2);
console.log(deed(() => {}, 2));
console.log(deed(undefined, 2));
console.log(deed(undefined, 0));
console.log(deed({}, 1));
console.log(deed(Made, 1));
console.log(deed(revoked.proxy, 1));
console.log(deed("text", 1));
