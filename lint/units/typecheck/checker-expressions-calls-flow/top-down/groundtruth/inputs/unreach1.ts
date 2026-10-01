function h(n: number): number {
    if (n > 0) {
        return 1;
        n++;
        n--;
    }
    throw new Error();
    const dead = 1;
}
function never(): never { throw 0; }
function i() {
    never();
    let after = 1;
}
while (true) { }
var tail = 1;
