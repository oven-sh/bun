// The shape of an emitter that writes its table of listeners with the names that it expects: a listener is laid by key, taken by storing undefined by key, and called by key.
type Listener = (value: number) => void;
type Table = Record<string, Listener | Listener[] | undefined>;
class Emitter {
    table: Table = { close: undefined, error: undefined, finish: undefined, drain: undefined, data: undefined };
    count = 0;
    on(name: string, listener: Listener) {
        const held = this.table[name];
        if (held === undefined) {
            this.table[name] = listener;
            this.count++;
        } else if (typeof held === "function")
            this.table[name] = [held, listener];
        else
            held.push(listener);
        return this;
    }
    off(name: string, listener: Listener) {
        const held = this.table[name];
        if (held === listener) {
            this.table[name] = undefined;
            this.count--;
        } else if (Array.isArray(held)) {
            const left = held.filter(one => one !== listener);
            this.table[name] = left.length === 1 ? left[0] : left;
        }
        return this;
    }
    emit(name: string, value: number) {
        const held = this.table[name];
        if (held === undefined) return false;
        if (typeof held === "function") held(value);
        else for (const one of held) one(value);
        return true;
    }
}
let total = 0;
const add: Listener = value => { total += value; };
const double: Listener = value => { total += 2 * value; };
const names = ["close", "error", "finish", "drain", "data", "other"];
const emitters = [new Emitter(), new Emitter(), new Emitter()];
for (let round = 0; round < 3000; round++) {
    const emitter = emitters[round % 3]!;
    for (const name of names) emitter.on(name, add);
    if (round % 5 === 0) for (const name of names) emitter.on(name, double);
    for (const name of names) emitter.emit(name, round);
    if (round % 5 === 0) for (const name of names) emitter.off(name, double);
    for (const name of names) emitter.off(name, add);
}
console.log(total, emitters.map(emitter => emitter.count + ":" + Object.keys(emitter.table).join(",") + ":" + Object.values(emitter.table).map(held => typeof held).join(",")).join(" | "));
