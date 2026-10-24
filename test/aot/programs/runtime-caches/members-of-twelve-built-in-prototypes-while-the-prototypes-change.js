// A member of a built-in prototype that the program calls on a known receiver, read by name through an unknown receiver,
// while other members of the prototype are deleted and the prototype is churned until its storage is packed anew.
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

const set = new Set([1]);
console.log(set.has(1), set.size, set.add(3).size);
scene("Set", set, Set.prototype, ["clear", "delete", "forEach", "entries", "union", "intersection", "difference", "isSubsetOf"],
    [o => o.has(1), o => o.add(2).size, o => o.has.name, o => o.add.name]);

const date = new Date(86400000);
console.log(date.getTime(), date.toISOString(), date.getUTCDate());
scene("Date", date, Date.prototype, ["getYear", "setYear", "toGMTString", "getDay", "getHours", "setHours", "getMinutes", "toLocaleString", "toDateString"],
    [o => o.getTime(), o => o.toISOString(), o => o.getUTCDate(), o => o.getTime.name, o => o.toISOString.name, o => o.getUTCDate.name]);

const list = [3, 1, 2];
console.log(list.slice(1).join(), list.indexOf(2), list.map(x => x + 1).join());
scene("Array", list, Array.prototype, ["copyWithin", "fill", "flat", "flatMap", "lastIndexOf", "reduceRight", "toSpliced", "with", "at", "findLast"],
    [o => o.slice(1).join(), o => o.indexOf(2), o => o.map(x => x + 1).join(), o => o.slice.name, o => o.indexOf.name, o => o.map.name, o => o.join.name]);

const promise = Promise.resolve(1);
promise.then(() => {});
scene("Promise", promise, Promise.prototype, ["finally", "catch"], [o => typeof o.then(() => {}), o => o.then.name]);

const text = "hello";
console.log(text.slice(1), text.indexOf("l"), text.toUpperCase());
scene("String", text, String.prototype, ["anchor", "big", "blink", "bold", "fixed", "fontcolor", "sub", "sup", "at", "codePointAt", "normalize"],
    [o => o.slice(1), o => o.indexOf("l"), o => o.toUpperCase(), o => o.slice.name, o => o.indexOf.name, o => o.toUpperCase.name]);

const number = 255;
console.log(number.toString(16), number.toFixed(1));
scene("Number", number, Number.prototype, ["toExponential", "toPrecision", "toLocaleString"], [o => o.toString(16), o => o.toFixed(1), o => o.toString.name, o => o.toFixed.name]);

const pattern = /l+/;
console.log(pattern.test("hello"), pattern.exec("hello")[0]);
scene("RegExp", pattern, RegExp.prototype, ["compile", "toString"], [o => o.test("hello"), o => o.exec("hello")[0], o => o.test.name, o => o.exec.name, o => o.source]);

function f(a, b) { return a + b; }
console.log(f.call(null, 1, 2), f.apply(null, [1, 2]), f.bind(null, 1)(2));
scene("Function", f, Function.prototype, ["toString"], [o => o.call(null, 1, 2), o => o.apply(null, [1, 2]), o => o.bind(null, 1)(2), o => o.call.name, o => o.apply.name, o => o.bind.name]);

const bytes = new Uint8Array([1, 2, 3]);
console.log(bytes.subarray(1).length, bytes.indexOf(2), bytes.length);
scene("TypedArray", bytes, Object.getPrototypeOf(Uint8Array.prototype), ["copyWithin", "fill", "lastIndexOf", "reduceRight", "toReversed", "with", "at", "findLast"],
    [o => o.subarray(1).length, o => o.indexOf(2), o => o.length, o => o.byteLength, o => o.subarray.name, o => o.indexOf.name]);

const buffer = Buffer.from("abc");
console.log(buffer.toString("hex"), buffer.readUInt8(0), buffer.length);
scene("Buffer", buffer, Buffer.prototype, ["readInt8", "writeInt8", "swap16", "swap32", "readDoubleBE", "writeDoubleBE", "asciiSlice", "latin1Slice"],
    [o => o.toString("hex"), o => o.readUInt8(0), o => o.length, o => o.toString.name, o => o.readUInt8.name]);

const error = new Error("m");
console.log(error.toString(), error.name, error.message);
scene("Error", error, Error.prototype, [], [o => o.toString(), o => o.name, o => o.message]);
console.log("done");
