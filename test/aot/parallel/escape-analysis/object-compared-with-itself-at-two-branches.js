// An object that never leaves is compared with itself, under another name that only the comparison uses, and the answer decides two branches.
function literal() {
    const object = { self: null, first: 0, second: 0 };
    object.self = object;
    object.first = object.self === object ? 1 : 2;
    object.second = object === object ? 3 : 4;
    return object;
}
function sameTestTwice() {
    const object = { self: null, first: 0, second: 0 };
    object.self = object;
    object.first = object.self === object ? 1 : 2;
    object.second = object.self === object ? 3 : 4;
    return object;
}
function throughLocal(other) {
    const object = { first: 0, second: 0, other };
    const alias = other ? object : object;
    if (alias === object)
        object.first = 1;
    else
        object.first = 2;
    object.other = null;
    if (alias === object)
        object.second = 3;
    else
        object.second = 4;
    return object;
}
class Node {
    root = [];
    parent;
    list;
    options;
    constructor(options = {}) {
        this.root = this.parent ? this.root : this;
        this.options = this.root === this ? options : this;
        this.list = this === this ? [] : this.list;
    }
}
class Hidden {
    #root = [];
    #parent;
    #list;
    #options;
    constructor(options = {}) {
        this.#root = this.#parent ? this.#root : this;
        this.#options = this.#root === this ? options : this;
        this.#list = this === this ? [] : this.#list;
    }
    get list() { return this.#list; }
    static make() { return new Hidden; }
}
function notEqual() {
    const object = { self: null, first: 0, second: 0 };
    object.self = object;
    object.first = object.self !== object ? 1 : 2;
    object.second = object !== object ? 3 : 4;
    return object;
}
for (let turn = 0; turn < 3; turn++) {
    const a = literal(), b = sameTestTwice(), c = throughLocal(turn), d = new Node, e = Hidden.make(), f = notEqual();
    console.log(a.first, a.second, b.first, b.second, c.first, c.second, Array.isArray(d.list), Array.isArray(e.list), f.first, f.second);
}
