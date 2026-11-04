// A counter is stepped in the key of a read, `list[i++]`, and the read throws: the handler and whoever comes behind it see the counter as stepped.
function sum(lists: any[], n: number) {
    let i = 0;
    let s = 0;
    try {
        while (i < n)
            s += lists[i++].length;
    } catch (e) {
        return "thrown with i = " + i + ", s = " + s;
    }
    return "i = " + i + ", s = " + s;
}
function sumWithoutHandler(list: number[], n: number) {
    let s = 0;
    for (let i = 0; i < (n & 7); )
        s = (s + list[i++]) | 0;
    return s;
}
function deed(lists: any[], n: number) {
    return sum(lists, n) + "; " + String(sumWithoutHandler([1, 2, 4, 8, 16, 32, 64], n));
}
const whole = JSON.parse("[[1], [1, 2], [1, 2, 3], []]");
const broken = JSON.parse("[[1], null, [1, 2, 3]]");
console.log(deed(whole, 4));
let last = "";
for (let i = 0; i < 300; i++)
    last = deed(whole, i & 3);
console.log(last);
console.log(deed(broken, 3));
console.log(deed(whole, 5));
console.log(deed(whole, 0));
