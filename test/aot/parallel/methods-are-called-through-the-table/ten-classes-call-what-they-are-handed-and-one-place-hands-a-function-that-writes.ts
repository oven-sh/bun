// STATISTIC: MethodCallsThroughTable >= 2
interface Caller { call(f: (n: number) => number): number }
var ledger = 0;
class Heron implements Caller { n = 0; call(f: (n: number) => number) { return f(this.n + 0) + 0; } }
class Otter implements Caller { n = 1; call(f: (n: number) => number) { return f(this.n + 1) + 1; } }
class Marten implements Caller { n = 2; call(f: (n: number) => number) { return f(this.n + 2) + 2; } }
class Plover implements Caller { n = 3; call(f: (n: number) => number) { return f(this.n + 3) + 3; } }
class Bittern implements Caller { n = 4; call(f: (n: number) => number) { return f(this.n + 4) + 4; } }
class Stoat implements Caller { n = 5; call(f: (n: number) => number) { return f(this.n + 5) + 5; } }
class Curlew implements Caller { n = 6; call(f: (n: number) => number) { return f(this.n + 6) + 6; } }
class Dunlin implements Caller { n = 7; call(f: (n: number) => number) { return f(this.n + 7) + 7; } }
class Lapwing implements Caller { n = 8; call(f: (n: number) => number) { return f(this.n + 8) + 8; } }
class Godwit implements Caller { n = 9; call(f: (n: number) => number) { return f(this.n + 9) + 9; } }
const all: Caller[] = [new Heron(), new Otter(), new Marten(), new Plover(), new Bittern(), new Stoat(), new Curlew(), new Dunlin(), new Lapwing(), new Godwit()];
function quiet(one: Caller) { const before = ledger; const got = one.call(n => n * 2); return got * 100 + (ledger - before); }
function loud(one: Caller) { const before = ledger; const got = one.call(n => { ledger += n + 1; return n; }); return got * 100 + (ledger - before); }
function quietAgain(one: Caller) { const before = ledger; const got = one.call(n => n + 3); return got * 100 + (ledger - before); }
let sum = 0;
for (const one of all) sum = (sum * 13 + quiet(one) + loud(one) * 3 + quietAgain(one) * 5) % 1000003;
console.log(sum, ledger);
