// An object above the receiver has the name as a plain data property, which stops no store. Then the property changes its form: read-only, an accessor, frozen with its object. Each kind of object above reports that in its own way.
// What is once known about a name may stay known, so each kind of change has two names of its own, and begins with another kind of object.
"use strict";
const lines = [];
const calls = [];
// What comes out of evaluated text is anything: nothing is proven about the receivers.
const hide = (0, eval)("(value) => value");
// The layout of the records has the names: some records are born with them.
function Record(id, isFull) {
    this.a = id;
    if (isFull) {
        this.firstCount = -1;
        this.firstSize = -2;
        this.secondCount = -1;
        this.secondSize = -2;
        this.thirdCount = -1;
        this.thirdSize = -2;
        this.fourthCount = -1;
        this.fourthSize = -2;
        this.fifthCount = -1;
        this.fifthSize = -2;
        this.sixthCount = -1;
        this.sixthSize = -2;
        this.seventhCount = -1;
        this.seventhSize = -2;
        this.eighthCount = -1;
        this.eighthSize = -2;
        this.ninthCount = -1;
        this.ninthSize = -2;
    }
}
function make(id, chain) {
    const record = new Record(id, false);
    Object.setPrototypeOf(record, chain);
    return record;
}
const stores = [
    {
        count: "firstCount",
        size: "firstSize",
        storeCount(given, value) {
            const record = hide(given);
            record.firstCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.firstSize = value;
            return record;
        },
    },
    {
        count: "secondCount",
        size: "secondSize",
        storeCount(given, value) {
            const record = hide(given);
            record.secondCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.secondSize = value;
            return record;
        },
    },
    {
        count: "thirdCount",
        size: "thirdSize",
        storeCount(given, value) {
            const record = hide(given);
            record.thirdCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.thirdSize = value;
            return record;
        },
    },
    {
        count: "fourthCount",
        size: "fourthSize",
        storeCount(given, value) {
            const record = hide(given);
            record.fourthCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.fourthSize = value;
            return record;
        },
    },
    {
        count: "fifthCount",
        size: "fifthSize",
        storeCount(given, value) {
            const record = hide(given);
            record.fifthCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.fifthSize = value;
            return record;
        },
    },
    {
        count: "sixthCount",
        size: "sixthSize",
        storeCount(given, value) {
            const record = hide(given);
            record.sixthCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.sixthSize = value;
            return record;
        },
    },
    {
        count: "seventhCount",
        size: "seventhSize",
        storeCount(given, value) {
            const record = hide(given);
            record.seventhCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.seventhSize = value;
            return record;
        },
    },
    {
        count: "eighthCount",
        size: "eighthSize",
        storeCount(given, value) {
            const record = hide(given);
            record.eighthCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.eighthSize = value;
            return record;
        },
    },
    {
        count: "ninthCount",
        size: "ninthSize",
        storeCount(given, value) {
            const record = hide(given);
            record.ninthCount = value;
            return record;
        },
        storeSize(given, value) {
            const record = hide(given);
            record.ninthSize = value;
            return record;
        },
    },
];
function attempt(store, chain, id) {
    const before = calls.length;
    let said;
    try {
        said = Object.keys(store.storeSize(store.storeCount(make(id, chain), id), id)).join();
    } catch (error) {
        said = error.constructor.name;
    }
    return said + (calls.length > before ? " {" + calls.slice(before).join() + "}" : "");
}
class Holder {
    constructor(store) {
        this[store.count] = 0;
        this[store.size] = 0;
    }
}
function Made(store) {
    this[store.count] = 0;
    this[store.size] = 0;
}
const plain = (value) => ({ value, writable: true, enumerable: true, configurable: true });
const holders = [
    ["a record born with the names", () => new Record(0, true)],
    ["a hidden record", () => hide(new Record(0, true))],
    ["of evaluated text", (store) => (0, eval)("({ " + store.count + ": 0, " + store.size + ": 0 })")],
    ["without the names", () => ({ other: 0 })],
    ["created with descriptors", (store) => Object.create(null, { [store.count]: plain(0), [store.size]: plain(0) })],
    ["an instance of a class", (store) => new Holder(store)],
    ["made by a function", (store) => new Made(store)],
    ["filled by name", (store) => store.storeSize(store.storeCount(new Record(0, false), 0), 0)],
];
const changes = [
    ["read-only", (holder, store) => Object.defineProperty(holder, store.count, { value: 9, writable: false, configurable: true })],
    ["read-only, the value kept", (holder, store) => Object.defineProperty(holder, store.count, { writable: false })],
    ["a setter", (holder, store) => Object.defineProperty(holder, store.count, { set(value) { calls.push("set " + value); }, configurable: true })],
    ["a getter alone", (holder, store) => Object.defineProperty(holder, store.size, { get() { return "got"; }, configurable: true })],
    ["frozen", (holder) => Object.freeze(holder)],
    ["sealed", (holder) => Object.seal(holder)],
    ["deleted and defined anew", (holder, store) => {
        delete holder[store.count];
        Object.defineProperty(holder, store.count, { value: 1, writable: false, configurable: true });
    }],
    ["read-only and writable again", (holder, store) => {
        Object.defineProperty(holder, store.count, { value: 9, writable: false, configurable: true });
        Object.defineProperty(holder, store.count, { value: 9, writable: true, configurable: true });
    }],
    ["another prototype with a setter", (holder, store) => Object.setPrototypeOf(holder, Object.defineProperty({}, store.size, { set(value) { calls.push("upper set " + value); } }))],
];
lines.push(Object.keys(new Record(0, true)).length);
changes.forEach(([changeName, change], changeIndex) => {
    const store = stores[changeIndex];
    for (let turn = 0; turn < holders.length; turn++) {
        const [holderName, makeHolder] = holders[(turn + changeIndex) % holders.length];
        for (const depth of [1 + (changeIndex & 1), 2 - (changeIndex & 1)]) {
            const holder = makeHolder(store);
            let chain = holder;
            for (let level = 1; level < depth; level++) {
                chain = Object.create(chain);
                chain.between = level;
            }
            const said = [];
            for (let id = 0; id < 3; id++)
                said.push(attempt(store, chain, id));
            let outcome = "";
            try {
                change(holder, store);
            } catch (error) {
                outcome = " (the change threw " + error.constructor.name + ")";
            }
            for (let id = 3; id < 6; id++)
                said.push(attempt(store, chain, id));
            lines.push(holderName + " | " + changeName + " | " + depth + outcome + ": " + said.join(" | "));
        }
    }
});
console.log(lines.join("\n"));
