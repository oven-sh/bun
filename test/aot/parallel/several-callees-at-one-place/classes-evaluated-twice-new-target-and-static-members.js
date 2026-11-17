// Two closures of one class beside another class; new.target, the prototype and the captures are those of the closure in hand.
function make(k) {
    return class Made {
        k = k;
        static label = "made " + k;
        who() { return new.target === undefined ? k : -1; }
        constructor() { this.target = new.target; }
    };
}
const Ten = make(10);
const Twenty = make(20);
class Other {
    k = 1;
    static label = "other";
    who() { return 0; }
    constructor() { this.target = new.target; }
}
class Below extends Ten { k = 3; }

const log = [];
for (let i = 0; i < 8; i++) {
    const place = i % 4;
    const C = place === 0 ? Ten : place === 1 ? Twenty : place === 2 ? Other : Below;
    const o = new C();
    log.push(o.k, o.who(), o.target === C, o.target.label, Object.getPrototypeOf(o) === C.prototype, o instanceof Ten, o instanceof Twenty);
}
console.log(log.join());
