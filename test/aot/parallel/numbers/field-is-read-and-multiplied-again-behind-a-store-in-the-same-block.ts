// One field is read and multiplied twice in a row of statements without a branch, with a store into it between, through the same name and through a second name of the object.
class Box {
    n: number;
    constructor(n: number) { this.n = n; }
}
function around(box: Box, other: Box) {
    const first = box.n * 2;
    other.n = other.n + 1;
    const second = box.n * 2;
    return first * 1000 + second;
}
function without(box: Box) {
    const first = box.n * 2;
    const second = box.n * 2;
    return first * 1000 + second;
}
function deed(box: Box, other: Box) {
    return String(around(box, other)) + " " + String(without(box));
}
const one = new Box(1);
const two = new Box(5);
console.log(deed(one, two));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(one, two);
console.log(last);
console.log(deed(one, one));
console.log(deed(two, two), String(one.n), String(two.n));
