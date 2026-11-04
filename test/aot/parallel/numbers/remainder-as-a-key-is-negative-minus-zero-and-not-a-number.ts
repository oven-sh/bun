// A list is read and stored under a remainder of two int32 that is negative, -0 and, by a divisor of zero, NaN.
function read(list: any, i: number, n: number) {
    return list[(i | 0) % (n | 0)];
}
function store(list: any, i: number, n: number, value: string) {
    list[(i | 0) % (n | 0)] = value;
}
function deed(list: any, i: number, n: number) {
    store(list, i, n, "stored " + i);
    return String(read(list, i, n)) + " [" + Object.keys(list).join() + "]";
}
const input = JSON.parse("[5, 3, -5, -3, 0]");
const ring: any = ["a", "b", "c"];
console.log(deed(ring, input[0], input[1]));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(ring, i, input[1]);
console.log(last);
console.log(deed(ring, input[2], input[1]));
console.log(deed(ring, input[3], input[1]));
console.log(deed(ring, input[0], input[4]));
console.log(String(ring.NaN), String(ring["-2"]), String(ring[0]));
