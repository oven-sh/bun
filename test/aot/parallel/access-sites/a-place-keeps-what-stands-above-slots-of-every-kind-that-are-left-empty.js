// Slots of several kinds that an instance leaves empty: a number, a boolean, a text, an object, and one of so many optional properties that it lies outside the cell.
// Each is read at a place of its own, 3,000 times, off instances below a class whose prototype stands below an object that has some of the names and lacks others.
// Then the name comes or goes above, and on the instance; the collector runs in between.
class Base { constructor(n) { this.n = n; } }
class Message extends Base {
    constructor(n, full) {
        super(n);
        this.id = n;
        if (full) {
            this.count = 7; this.ratio = 0.5; this.done = true; this.title = "its own title"; this.owner = { name: "its own owner" };
            this.o1 = 1; this.o2 = 2; this.o3 = 3; this.o4 = 4; this.o5 = 5; this.o6 = 6; this.o7 = 7; this.o8 = 8; this.o9 = 9; this.o10 = 10; this.o11 = 11; this.o12 = 12; this.late = "its own late one";
        }
    }
}
class Other1 { constructor() { this.count = 1; this.ratio = 1.5; this.done = false; this.title = "t"; this.owner = null; this.late = 1; } }
class Other2 { constructor() { this.late = 2; this.owner = null; this.title = "t"; this.done = false; this.ratio = 1.5; this.count = 1; this.x = 1; } }
class Other3 { constructor() { this.x = 1; this.y = 2; this.title = "t"; this.count = 1; this.late = 3; this.ratio = 1.5; this.done = false; this.owner = null; } }
class Other4 { constructor() { this.z = 1; this.done = false; this.late = 4; this.count = 1; this.owner = null; this.title = "t"; this.ratio = 2.5; } }
class Other5 { constructor() { this.w = 1; this.v = 1; this.u = 1; this.ratio = 2.5; this.late = 5; this.title = "t"; this.owner = null; this.done = true; this.count = 2; } }
const others = [new Other1, new Other2, new Other3, new Other4, new Other5];
const readers = {
    count: [o => o.count, o => o.count, o => o.count], ratio: [o => o.ratio, o => o.ratio, o => o.ratio], done: [o => o.done, o => o.done, o => o.done],
    title: [o => o.title, o => o.title, o => o.title], owner: [o => o.owner, o => o.owner, o => o.owner], late: [o => o.late, o => o.late, o => o.late],
};
console.log(new Function("readers", "others", "Message", "Base", "collect", `
    const lines = [];
    const show = value => typeof value === "object" && value !== null ? "{" + value.name + "}" : String(value);
    const beginnings = [() => ({ }), name => ({ [name]: "above in the cell" }), name => { const root = { }; for (let i = 0; i < 12; i++) root["p" + i] = i; root[name] = "above in the storage"; return root; }];
    for (const name of Object.keys(readers)) {
        beginnings.forEach((begin, which) => {
            const root = begin(name);
            Object.setPrototypeOf(Base.prototype, root);
            const read = readers[name][which];
            let seen;
            for (let turn = 0; turn < 3000; turn++) seen = read(new Message(turn, false));
            const one = new Message(1, false), other = new Message(2, false), full = new Message(3, true);
            collect();
            lines.push(name + " " + which + ": " + show(seen) + " . " + show(read(full)) + " . " + show(read(one)) + " . " + show(read(others[which])));
            if (which) delete root[name]; else root[name] = "came above";
            lines.push(" > " + show(read(one)) + " | " + show(read(full)) + " | " + show(read(new Message(4, false))));
            for (let turn = 0; turn < 3000; turn++) seen = read(new Message(turn, false));
            one[name] = "stored on the instance";
            collect();
            lines.push(" > " + show(seen) + " | " + show(read(one)) + " | " + show(read(other)) + " | " + show(read(full)));
            delete one[name];
            Message.prototype[name] = "on the prototype of the class";
            lines.push(" > " + show(read(one)) + " | " + show(read(other)) + " | " + show(read(full)));
            delete Message.prototype[name];
            lines.push(" > " + show(read(one)) + " | " + show(read(other)) + " | " + show(read(full)));
        });
    }
    return lines.join("\\n");
`)(readers, others, Message, Base, () => Bun.gc(true)));
