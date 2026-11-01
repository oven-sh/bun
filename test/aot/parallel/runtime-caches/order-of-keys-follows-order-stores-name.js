// Fields that stores by name create are listed in the order of the stores, whatever order the layout has them in.
const lines = [];
function show(what, object) {
    const byForIn = [];
    for (const key in object)
        byForIn.push(key);
    lines.push(what + ": " + Object.keys(object).join() + " | " + JSON.stringify(object) + " | " + byForIn.join() + " | " + Object.keys({ ...object }).join() + " | " + Object.entries(object).map(([key, value]) => key + "=" + value).join() + " | " + Reflect.ownKeys(object).map(String).join());
}
// What comes out of evaluated text is anything: nothing is proven about the receivers.
const hide = (0, eval)("(value) => value");
function put(given, key, value) {
    const object = hide(given);
    switch (key) {
    case "a": object.a = value; break;
    case "b": object.b = value; break;
    case "c": object.c = value; break;
    case "d": object.d = value; break;
    case "e": object.e = value; break;
    }
}
// Seen code gives the object all five names on one path, so that its layout has fields for them.
function fresh(full) {
    const made = {};
    if (full) {
        made.a = 1;
        made.b = 2;
        made.c = 3;
        made.d = 4;
        made.e = 5;
    }
    return made;
}
show("full", fresh(true));
function permutations(items) {
    if (items.length < 2)
        return [items];
    const all = [];
    for (let index = 0; index < items.length; ++index) {
        const rest = items.slice(0, index).concat(items.slice(index + 1));
        for (const tail of permutations(rest))
            all.push([items[index], ...tail]);
    }
    return all;
}
for (const order of permutations(["a", "b", "c", "d"])) {
    const object = fresh();
    let value = 0;
    for (const key of order)
        put(object, key, ++value);
    show(order.join(""), object);
}
// Twice, so that what the first time left behind is used.
for (const order of [["d", "c", "b", "a"], ["a", "c", "e"], ["e"], ["b", "e", "a"]]) {
    for (let round = 0; round < 2; ++round) {
        const object = fresh();
        for (const key of order)
            put(object, key, key + round);
        show(order.join("") + round, object);
    }
}
// Deleted and created again: the key goes to the end.
{
    const object = fresh();
    for (const key of ["a", "b", "c"])
        put(object, key, key);
    delete object.a;
    show("without a", object);
    put(object, "a", "again");
    show("a again", object);
    delete object.b;
    delete object.c;
    put(object, "c", 1);
    put(object, "b", 2);
    show("c and b again", object);
}
// Names outside the layout between the fields, numbers and symbols among them.
{
    const object = fresh();
    const extra = "x" + Math.floor(1.5);
    put(object, "b", 1);
    object[extra] = 2;
    put(object, "a", 3);
    object[7] = 4;
    object[Symbol.for("s")] = 5;
    put(object, "d", 6);
    object[2] = 7;
    put(object, "c", 8);
    show("with strangers", object);
}
// Literals that list some fields, then stores.
function complete(made, full) {
    if (full) {
        made.a = 1;
        made.b = 2;
        made.c = 3;
        made.d = 4;
        made.e = 5;
    }
    return made;
}
function listed(kind, full) {
    switch (kind) {
    case 0: return complete({ a: 1 }, full);
    case 1: return complete({ b: 1, a: 2 }, full);
    case 2: return complete({ c: 1, a: 2, b: 3 }, full);
    default: return complete({ d: 1 }, full);
    }
}
for (let kind = 0; kind < 4; ++kind)
    show("complete " + kind, listed(kind, true));
for (let kind = 0; kind < 4; ++kind) {
    for (const order of [["e", "d", "c", "b", "a"], ["a", "b", "c", "d", "e"]]) {
        const object = listed(kind);
        for (const key of order)
            put(object, key, key + kind);
        show("listed " + kind + " " + order.join(""), object);
    }
}
// undefined is a value like any other.
{
    const object = fresh();
    put(object, "c", undefined);
    put(object, "a", undefined);
    show("undefined twice", object);
    lines.push(String("c" in object) + " " + String("b" in object) + " " + Object.hasOwn(object, "a"));
    put(object, "c", 1);
    put(object, "b", null);
    show("then values", object);
}
console.log(lines.join("\n"));
