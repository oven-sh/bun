function report(name, run) {
    let text;
    try { text = String(run()); } catch (error) { text = "threw " + error.name; }
    console.log(name + " -> " + text);
}
function summary(array) {
    let sum = 0;
    let holes = 0;
    for (let index = 0; index < array.length; index++) {
        if (!(index in array)) holes++;
        const value = array[index];
        sum += typeof value === "number" ? value : value === undefined ? 0 : 1;
    }
    return array.length + " " + sum + " " + holes;
}
function integers(count) {
    const array = [];
    for (let index = 0; index < count; index++)
        array.push(index);
    return array;
}

for (const first of [0, 1, 70000, 200000]) {
    for (const second of [0, 1, 70000, 200000]) {
        const a = integers(first);
        const b = integers(second);
        report("integers " + first + " and " + second, () => summary([...a, ...b]));
    }
}

report("holes read as undefined", () => summary([...[1, , 3], ...[, 5]]));
report("literal holes", () => summary([1, , ...[2], , 3]));
report("doubles into contiguous", () => summary(["text", ...[1.5, 2.5], {}, ...[3.5]]));
report("long doubles into contiguous", () => summary(["text", ...integers(70000).map(value => value + 0.5)]));
report("integers into doubles", () => summary([0.5, ...[1, 2]]));
report("strings into integers", () => summary([1, ...["a", "b"]]));

report("typed array", () => summary([...new Uint8Array([1, 2, 3]), ...new Float64Array([0.5])]));
report("empty typed array", () => summary([...new Int32Array(0)]));
report("detached typed array", () => {
    const buffer = new ArrayBuffer(8);
    const view = new Uint8Array(buffer);
    buffer.transfer();
    return summary([...view]);
});

report("Map", () => [...new Map([[1, 2], [3, 4]])].join("|"));
report("Map keys", () => [...new Map([[1, 2], [3, 4]]).keys()].join("|"));
report("Set", () => [...new Set([1, 2, 2, 3])].join("|"));
report("string", () => [..."a\u{1F600}b"].length);
report("generator", () => [...(function* () { yield 1; yield 2; })()].join("|"));

report("array with own iterator", () => {
    const array = [1, 2, 3];
    array[Symbol.iterator] = function* () { yield "own"; };
    return [...array].join("|");
});
class Plain extends Array {}
report("subclass without iterator", () => [...Plain.of(1, 2, 3)].join("|"));
class Reversed extends Array {
    *[Symbol.iterator]() { for (let index = this.length - 1; index >= 0; index--) yield this[index]; }
}
report("subclass with iterator", () => [...Reversed.of(1, 2, 3)].join("|"));

report("not iterable", () => [...5]);
report("null", () => [...null]);

let closed = 0;
const failing = {
    [Symbol.iterator]() {
        let count = 0;
        return {
            next() {
                if (++count > 2) throw new RangeError("stop");
                return { value: count, done: false };
            },
            return() { closed++; return {}; },
        };
    },
};
let literal = "not assigned";
report("next throws", () => { literal = [0, ...failing, 9]; return literal; });
console.log(literal, closed);
