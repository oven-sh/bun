"use strict";
let nextId = 1;
class Ticket {
    constructor({ lane, kind = "plain", cost = 0, count, holder, mark = "N" }) { this.id = nextId++; this.lane = lane; this.kind = kind; this.cost = cost; this.count = count; this.holder = holder; this.mark = mark; }
}
class Desk {
    constructor() { this.all = new Map(); }
    submit(fields) { const ticket = new Ticket(fields); this.all.set(ticket.id, ticket); return ticket; }
}
function steps(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
class Clerk {
    constructor(name, desk, seed) { this.name = name; this.desk = desk; this.random = steps(seed); }
    act(mid) {
        const r = this.random(), lane = this.random() < 0.5 ? "left" : "right";
        const away = Math.floor(this.random() * 8) - 2;
        return this.desk.submit({
            lane,
            kind: r > 0.9 ? "rush" : "plain",
            cost: lane === "left" ? mid - away : mid + away,
            count: 1 + Math.floor(this.random() * 9),
            holder: this.name,
            mark: r > 0.8 && r <= 0.9 ? "F" : r > 0.9 ? "I" : undefined,
        });
    }
}
function f(t) {
    const desk = new Desk(), clerks = [];
    for (let i = 0; i < 4; i++) clerks.push(new Clerk("c" + i, desk, 7 + i + t));
    let s = 0;
    for (let step = 0; step < 40; step++) { const ticket = clerks[step % 4].act(100); s += ticket.cost + ticket.count + ticket.holder.length + ticket.mark.length + ticket.kind.length + ticket.lane.length; }
    return s + desk.all.size;
}
const n = Number(process.argv[2] || 3);
let sum = 0;
for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000000007;
console.log(sum);
