function later() { function Message(url) { this.id = 1; this.url = url; } return Message; }
const log = [], list = [later(), later(), later()], out = [];
Object.defineProperty(list[1].prototype, "url", { set(v) { log.push("set " + v); }, configurable: true });
for (let round = 0; round < 3; round++) for (const C of list) out.push(Object.keys(new C("/" + round)).join());
for (const C of list) out.push(Object.keys(new C("/last")).join());
console.log(out.join(" "), log.join());
