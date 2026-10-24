// What a method found by name returns is itself read by name, for a Map and for a Buffer, while members of their prototypes are deleted and many names come and go.
function churn(proto, tag) {
    for (let i = 0; i < 300; i++) {
        try {
            proto[tag + i] = i;
            delete proto[tag + i];
        } catch {
            return;
        }
    }
}
function drop(proto, names) {
    const done = [];
    for (const name of names) {
        try { if (delete proto[name]) done.push(name); } catch (e) { done.push("!" + name); }
    }
    return done.length;
}
function absent(o) { return o.nothingOfThisName; }
function absent2(o) { return o.nothingOfThatName; }

function scene(title, known, proto, open, reads) {
    const odd = [{}, { a: 1 }, function () {}];
    const take = () => reads.map(read => { try { return String(read(known)); } catch (e) { return "threw " + e.constructor.name; } }).join(" | ");
    let first = "";
    for (let i = 0; i < 60; i++) { first = take(); for (const o of odd) for (const read of reads) { try { read(o); } catch {} } }
    console.log(title, "before:", first);
    drop(proto, open);
    console.log(title, "dropped:", take());
    churn(proto, "z" + title);
    console.log(title, "churned:", take());
    for (let i = 0; i < 40; i++) { absent(known); absent2(known); }
    console.log(title, "walked:", take());
    for (let i = 0; i < 60; i++) take();
    console.log(title, "again:", take());
}

const map = new Map([[1, "one"]]);
console.log(map.get(1), map.has(1), map.size);
scene("Map", map, Map.prototype, ["clear", "delete", "forEach", "entries", "keys", "values", "getOrInsert", "getOrInsertComputed"],
    [o => o.get(1), o => o.has(1), o => o.set(2, "two").size, o => typeof o.get, o => o.get.name, o => o.has.name, o => o.set.name]);

const buffer = Buffer.from("abc");
console.log(buffer.toString("hex"), buffer.readUInt8(0), buffer.length);
scene("Buffer", buffer, Buffer.prototype, ["readInt8", "writeInt8", "swap16", "swap32", "readDoubleBE", "writeDoubleBE", "asciiSlice", "latin1Slice"],
    [o => o.toString("hex"), o => o.readUInt8(0), o => o.length, o => o.toString.name, o => o.readUInt8.name]);
