// One read in the source, reached by objects of two classes that are made only for it.
class A { id: number; declare retries: number; constructor(id: number) { this.id = id; } }
class B { id: number; declare retries: number; constructor(id: number) { this.id = id; } }
A.prototype.retries = 3;
B.prototype.retries = 40;
function set(m: A | B, on: boolean) { if (on) m.retries = 500; }
function read(m: A | B): number { return m.retries; }

function inlinedTwice(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s += read(new A(i)) * 1000 + read(new B(i));
    return s;
}
function inlinedTwiceTheOtherWay(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s += read(new B(i)) * 1000 + read(new A(i));
    return s;
}
function chosenByTurn(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const m = (i & 1) ? new A(i) : new B(i);
        s += m.retries;
    }
    return s;
}
function chosenByTurnWithAStore(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) {
        const m = (i % 3) ? new A(i) : new B(i);
        if ((i & 63) === 0) m.retries = 7;
        s += m.retries;
    }
    return s;
}
set(new A(0), true); set(new B(0), true);
for (let round = 0; round < 3; round++)
    console.log(inlinedTwice(10), inlinedTwiceTheOtherWay(10), chosenByTurn(10), chosenByTurnWithAStore(200), inlinedTwice(1), chosenByTurn(1));
