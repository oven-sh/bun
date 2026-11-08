// STATISTIC: MethodCallsThroughTable >= 2
interface Pair { calm(n: number): number; wild(n: number): number }
var heap = 0;
class Heron implements Pair { n = 0; calm(n: number) { return n + 0; } wild(n: number) { heap += n * 1; return 0; } }
class Otter implements Pair { n = 1; calm(n: number) { return n + 1; } wild(n: number) { heap += n * 2; return 1; } }
class Marten implements Pair { n = 2; calm(n: number) { return n + 2; } wild(n: number) { heap += n * 3; return 2; } }
class Plover implements Pair { n = 3; calm(n: number) { return n + 3; } wild(n: number) { heap += n * 4; return 3; } }
class Bittern implements Pair { n = 4; calm(n: number) { return n + 4; } wild(n: number) { heap += n * 5; return 4; } }
class Stoat implements Pair { n = 5; calm(n: number) { return n + 5; } wild(n: number) { heap += n * 6; return 5; } }
class Curlew implements Pair { n = 6; calm(n: number) { return n + 6; } wild(n: number) { heap += n * 7; return 6; } }
class Dunlin implements Pair { n = 7; calm(n: number) { return n + 7; } wild(n: number) { heap += n * 8; return 7; } }
class Lapwing implements Pair { n = 8; calm(n: number) { return n + 8; } wild(n: number) { heap += n * 9; return 8; } }
class Godwit implements Pair { n = 9; calm(n: number) { return n + 9; } wild(n: number) { heap += n * 10; return 9; } }
const all: Pair[] = [new Heron(), new Otter(), new Marten(), new Plover(), new Bittern(), new Stoat(), new Curlew(), new Dunlin(), new Lapwing(), new Godwit()];
function askCalm(one: Pair) { const before = heap; const got = one.calm(2); return got * 100 + (heap - before); }
function askWild(one: Pair) { const before = heap; const got = one.wild(3); return got * 100 + (heap - before); }
let sum = 0;
for (const one of all) sum = (sum * 19 + askCalm(one) + askWild(one) * 3) % 1000003;
console.log(sum, heap);
