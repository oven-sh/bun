// A view is read and stored under -1 and 1.5 while the object above it has properties and setters under those very keys: a view answers for every number by itself.
let log = "";
function read(view: Uint8Array, i: number) {
    const all: any = view;
    return String(all[-1 - (i & 3)]) + " " + String(all[(i & 3) + 0.5]);
}
function store(view: Uint8Array, i: number) {
    "use strict";
    const all: any = view;
    all[-1 - (i & 3)] = 7;
    all[(i & 3) + 0.5] = 8;
}
function deed(view: Uint8Array, i: number) {
    store(view, i);
    return read(view, i) + " [" + Object.keys(view).join() + "] " + log;
}
const view = new Uint8Array(2);
console.log(deed(view, 0));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(view, i);
console.log(last);
const above = Object.create(Uint8Array.prototype, {
    "-1": { get() { log += "g"; return "above"; }, set() { log += "s"; } },
    "0.5": { value: "above", writable: true },
});
Object.setPrototypeOf(view, above);
console.log(deed(view, 0));
console.log(String((view as any)["-1"]), String((view as any)["0.5"]), String((view as any)["-01"]));
