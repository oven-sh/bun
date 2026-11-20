// A class of a webpack module extends the class that another module exports as a whole. Its objects have one layout with the parent's fields, and the parent's methods know them.
// COUNTER in every build: DynamicSubclassInstances = 0
(() => {
    var modules = {
        "./peg.js": ((module, exports, __webpack_require__) => {
            "use strict";
            class Peg {
                constructor(kind) { this.hung = 0; this.kind = kind; this.above = undefined; }
                get whole() { return this; }
                hang() { return ++this.hung; }
                tell() { return Object.keys(this).join() + this.kind; }
            }
            module.exports = Peg;
        }),
        "./shelf.js": ((module, exports, __webpack_require__) => {
            "use strict";
            let Peg = __webpack_require__("./peg.js");
            let kinds = {};
            class Shelf extends Peg {
                constructor(kind) { super(kind); this.pegs = []; }
                add(peg) { this.pegs.push(peg); peg.above = this; return this.whole; }
                weigh(how) {
                    let weight = 0;
                    for (const peg of this.whole.pegs) weight += how(peg, weight & 7);
                    return weight;
                }
                spare() { return new kinds.Box("spare"); }
            }
            Shelf.learns = (name, kind) => { kinds[name] = kind; };
            Shelf.own = Shelf;
            module.exports = Shelf;
        }),
        "./box.js": ((module, exports, __webpack_require__) => {
            "use strict";
            let Shelf = __webpack_require__("./shelf.js");
            let Base = Shelf;
            class Box extends Base {
                constructor(label) { super("box"); this.label = label; }
                tell() { return this.label + ":" + super.tell(); }
            }
            Shelf.learns("Box", Box);
            module.exports = Box;
        }),
        "./hall.js": ((module, exports, __webpack_require__) => {
            "use strict";
            class Hall extends __webpack_require__("./shelf.js") {
                constructor() { super("hall"); }
            }
            module.exports = Hall;
        }),
        "./entry.js": ((module, exports, __webpack_require__) => {
            "use strict";
            let Box = __webpack_require__("./box.js"), Hall = __webpack_require__("./hall.js"), Peg = __webpack_require__("./peg.js"), Shelf = __webpack_require__("./shelf.js");
            let hall = new Hall(), weight = 0;
            for (let i = 0; i < 50; ++i)
                hall.add(new Box("s" + i).add(new Peg("bare")));
            for (let round = 0; round < 20; ++round)
                weight += hall.weigh((box, at) => box.weigh(peg => peg.hang() + at));
            console.log(weight, hall.tell(), hall.pegs[3].tell(), hall.pegs[3].pegs[0].tell());
            console.log(hall instanceof Shelf, hall.pegs[0] instanceof Peg, hall.spare().tell(), Object.getPrototypeOf(Box) === Shelf, Shelf.own === Shelf);
            // What is laid between later is found.
            Shelf.prototype.weigh = function () { return -1; };
            Object.defineProperty(Peg.prototype, "kind", { set(value) { this.seen = value; }, get() { return "got"; }, configurable: true });
            let late = new Box("late");
            console.log(hall.weigh(() => 1), JSON.stringify(late), late.kind);
            Object.setPrototypeOf(Box.prototype, Hall.prototype);
            Object.setPrototypeOf(Box, Hall);
            console.log(new Box("moved") instanceof Hall, JSON.stringify(new Box("moved")));
        }),
    };
    var cache = {};
    function __webpack_require__(id) {
        var cached = cache[id];
        if (cached !== undefined) { return cached.exports; }
        var module = cache[id] = { exports: {} };
        modules[id](module, module.exports, __webpack_require__);
        return module.exports;
    }
    __webpack_require__("./entry.js");
})();
