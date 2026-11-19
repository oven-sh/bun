"use strict";
const names = JSON.parse('["ann", "bob", 7, null, {"n": 1}, "cy", 2.5, true, "dee"]');
const out = [];
class Holder {
    constructor(name) { this.name = name; this.seed = 1; }
    random() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
    make(i) {
        const r = this.random();
        return {
            side: i & 1 ? "a" : "b",
            kind: r > 0.5 ? "x" : "y",
            price: Math.floor(this.random() * 8) + i,
            owner: this.name,
            tif: r > 0.8 ? "F" : r > 0.6 ? "I" : undefined,
        };
    }
    makeWithTheDoorLast(i) { return { side: i & 1 ? "a" : "b", price: Math.floor(this.random() * 8), owner: this.name }; }
    makeWithTheDoorFirst(i) { return { owner: this.name, side: this.random() > 0.5 ? "a" : "b", price: i }; }
    makeWithTwoDoors(i) { return { owner: this.name, side: this.random() > 0.5 ? "a" : "b", other: names[i % names.length], price: this.random() > 0.5 ? i : -i }; }
    makeAndThrow(i) { return { side: "a", owner: this.name, price: i === 3 ? fail() : this.random() > 2 ? 0 : i }; }
}
function fail() { throw new RangeError("three"); }
function take({ side, kind = "k", price = 0, owner, tif = "G" }) { return side + kind + price + String(owner && owner.n ? "obj" : owner) + tif; }
function sum(record) { return record.side + ":" + record.price + ":" + typeof record.owner; }
const holders = names.map(name => new Holder(name));
let text = "";
for (let i = 0; i < 40; i++) {
    const holder = holders[i % holders.length];
    const made = holder.make(i);
    text += take(made) + Object.keys(made).join("") + JSON.stringify(made).length + ";";
    text += sum(holder.makeWithTheDoorLast(i)) + sum(holder.makeWithTheDoorFirst(i)) + sum(holder.makeWithTwoDoors(i)) + ";";
    try { text += sum(holder.makeAndThrow(i % 5)); } catch (error) { text += error.constructor.name; }
}
out.push(text.length, text.slice(0, 300), text.slice(-200));
const kept = holders[0].make(1); kept.owner = 5; out.push(take(kept)); delete kept.kind; out.push(take(kept), Object.keys(kept).join()); kept.kind = "late"; out.push(take(kept), Object.keys(kept).join());
const frozen = Object.freeze(holders[1].make(2)); try { frozen.price = 1; } catch (error) { out.push(error.constructor.name); } out.push(take(frozen));
const withAccessor = holders[5].make(3); Object.defineProperty(withAccessor, "owner", { get() { return "got"; }, enumerable: true, configurable: true }); out.push(take(withAccessor));
const below = Object.create(holders[8].make(4)); out.push(take(below), Object.keys(below).length);
console.log(out.map(String).join("\n"));
