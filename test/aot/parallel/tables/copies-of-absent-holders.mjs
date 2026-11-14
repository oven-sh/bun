class Emitter {
    constructor() {
        this._events = Object.create(null);
    }
    emit(type) {
        const handler = this._events[type];
        if (handler === undefined)
            return false;
        const listeners = arrayClone(handler, handler.length);
        for (let i = 0; i < listeners.length; ++i)
            listeners[i].call(this);
        return true;
    }
    count(type) {
        const handler = this._events[type];
        return handler === undefined ? 0 : arrayClone(handler, handler.length).length;
    }
}

function arrayClone(list, count) {
    const copy = new Array(count);
    for (let i = 0; i < count; ++i)
        copy[i] = list[i];
    return copy;
}

class Table {
    constructor() {
        this.lists = Object.create(null);
    }
    move(key) {
        const list = this.lists[key];
        return list === undefined ? 0 : moveUp(list, list.length);
    }
    countMoved(key) {
        const list = this.lists[key];
        return list === undefined ? 0 : moveUp(list, list.length).length;
    }
    fill(key) {
        const list = this.lists[key];
        return list === undefined ? 0 : fill(list, 1, list.length);
    }
    countFilled(key) {
        const list = this.lists[key];
        return list === undefined ? 0 : fill(list, "x", list.length).length;
    }
}

function moveUp(list, count) {
    for (let i = 0; i < count; ++i)
        list[i + 1] = list[i];
    return list;
}

function fill(list, value, count) {
    for (let i = 0; i < count; ++i)
        list[i] = value;
    return list;
}

const held = new Map();

function copyOf(list, count) {
    const copy = new Array(count);
    for (let i = 0; i < count; ++i)
        copy[i] = list[i];
    return copy;
}

function countOf(key) {
    const list = held.get(key);
    return list === undefined ? 0 : copyOf(list, list.length).length;
}

function listOf(key) {
    const list = held.get(key);
    return list === undefined ? "none" : copyOf(list, list.length);
}

const emitter = new Emitter(), table = new Table();
console.log(emitter.emit("a"), emitter.emit("b"), emitter.count("c"));
console.log(table.move("a"), table.countMoved("b"), table.fill("a"), table.countFilled("c"));
console.log(countOf(1), listOf(2));
