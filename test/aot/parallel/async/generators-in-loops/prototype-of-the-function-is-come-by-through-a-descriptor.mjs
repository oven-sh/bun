// the object under `prototype` of a generator function is come by without a read off the function: out of a descriptor, through Reflect.get, out of all descriptors at once. A `next` or a `return` that is laid on it there is what every loop calls
function* byDescriptor() { yield 1; yield 2; yield 3; }
function* byReflect() { yield 1; yield 2; yield 3; }
function* byAllDescriptors() { yield 1; yield 2; yield 3; }
function* closedEarly() { yield 1; yield 2; yield 3; }
function* untouched() { yield 1; yield 2; yield 3; }
function seen(make) {
    const values = [];
    for (const value of make()) values.push(value);
    return values.join() || "nothing";
}
function firstOf(make) {
    for (const value of make()) return "first " + value;
    return "nothing";
}
function tellAll(when) {
    console.log(when, seen(byDescriptor), seen(byReflect), seen(byAllDescriptors), firstOf(closedEarly), seen(untouched));
}
tellAll("before:");
let turns = 0;
Object.getOwnPropertyDescriptor(byDescriptor, "prototype").value.next = function () {
    return { done: ++turns > 2, value: "mine " + turns };
};
Reflect.get(byReflect, "prototype").next = function () {
    return { done: true, value: undefined };
};
const all = Object.getOwnPropertyDescriptors(byAllDescriptors);
let steps = 0;
all.prototype.value.next = function () {
    return { done: ++steps !== 1, value: "one step" };
};
Object.getOwnPropertyDescriptor(closedEarly, "prototype").value.return = function (value) {
    console.log("a return of its own is called");
    return { done: true, value };
};
tellAll("behind:");
turns = 0;
steps = 0;
for (let i = 0; i < 3; i++) {
    tellAll("turn " + i + ":");
    turns = 0;
    steps = 0;
}
