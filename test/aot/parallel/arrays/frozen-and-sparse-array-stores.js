"use strict";

function report(name, run) {
    let text;
    try { text = String(run()); } catch (error) { text = error.name + ": " + error.message; }
    console.log(name + " -> " + text);
}
function store(array, key, value) { array[key] = value; return array.join("|"); }

for (const [name, seal] of [["frozen", Object.freeze], ["sealed", Object.seal], ["non-extensible", Object.preventExtensions]]) {
    report(name + " store in bounds", () => store(seal([1, 2, 3]), 1, 20));
    report(name + " store at the end", () => store(seal([1, 2, 3]), 3, 40));
    report(name + " store far past the end", () => store(seal([1, 2, 3]), 1000, 40));
    report(name + " store by name", () => store(seal([1, 2, 3]), "name", 40));
    report(name + " doubles", () => store(seal([1.5, 2.5]), 0, 3.5));
    report(name + " strings", () => store(seal(["a", "b"]), 0, "c"));
}

report("read-only element", () => {
    const array = [1, 2];
    Object.defineProperty(array, 0, { value: 5, writable: false });
    return store(array, 0, 6);
});
report("read-only length", () => {
    const array = [1, 2];
    Object.defineProperty(array, "length", { writable: false });
    return store(array, 2, 3);
});

report("largest index", () => {
    const array = [];
    array[2 ** 32 - 2] = "last";
    return array.length + " " + array[2 ** 32 - 2] + " " + Object.keys(array).join("|");
});
report("first name past the indexes", () => {
    const array = [];
    array[2 ** 32 - 1] = "name";
    return array.length + " " + array[2 ** 32 - 1] + " " + Object.keys(array).join("|");
});
report("past the largest index", () => {
    const array = [1];
    array[2 ** 32] = "name";
    return array.length + " " + Object.keys(array).join("|");
});

report("store far past the end, then back-fill", () => {
    const array = [];
    const last = 50000;
    array[last] = last;
    for (let index = last - 1; index >= 0; index--)
        array[index] = index;
    let sum = 0;
    for (let index = 0; index <= last; index++)
        sum += array[index];
    return array.length + " " + sum;
});
report("sparse values stay after more stores", () => {
    const array = [1, 2, 3];
    array[100000] = "far";
    array[3] = 4;
    array[99999] = "near";
    return array.length + " " + array[3] + " " + array[99999] + " " + array[100000] + " " + array[50000];
});

report("in-bounds integers", () => store([1, 2, 3], 1, 20));
report("in-bounds double into integers", () => store([1, 2, 3], 1, 2.5));
report("in-bounds string into doubles", () => store([1.5, 2.5], 1, "b"));
report("store at the end", () => store([1, 2, 3], 3, 4));
report("store leaves a hole", () => { const array = [1]; array[3] = 4; return array.length + " " + (2 in array); });
