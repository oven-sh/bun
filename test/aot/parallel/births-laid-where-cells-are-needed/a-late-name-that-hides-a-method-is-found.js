// An object gains a name that hides a method of its class before one turn in two lays it where the method is called.
class Gauge {
    constructor(level) { this.level = level; }
    read() { return this.level; }
}
const holder = { last: new Gauge(0) };
function measure(other, wide, keeps) {
    const gauge = new Gauge(5);
    if (wide)
        gauge.width = 1;
    gauge.read = () => 7;
    const before = other.read();
    if (keeps)
        holder.last = gauge;
    return before + holder.last.read();
}
const plain = new Gauge(1);
const said = [];
const ways = { measure };
for (const name of Object.keys(ways)) {
    for (let i = 0; i < 8; i++)
        said.push(ways[name](plain, (i & 1) === 1, (i & 2) === 2));
}
console.log(said.join(" "));
