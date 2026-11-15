interface Singer { sing(loud: number): number }
var notes = 0;
class Heron implements Singer { n = 0; sing(loud: number) { notes += loud; return 0 + loud; } }
class Otter implements Singer { n = 1; sing(loud: number) { notes += loud; return 1 + loud; } }
class Marten implements Singer { n = 2; sing(loud: number) { notes += loud; return 2 + loud; } }
class Plover implements Singer { n = 3; sing(loud: number) { notes += loud; return 3 + loud; } }
class Bittern implements Singer { n = 4; sing(loud: number) { notes += loud; return 4 + loud; } }
class Stoat implements Singer { n = 5; sing(loud: number) { notes += loud; return 5 + loud; } }
class Curlew implements Singer { n = 6; sing(loud: number) { notes += loud; return 6 + loud; } }
class Dunlin implements Singer { n = 7; sing(loud: number) { notes += loud; return 7 + loud; } }
class Lapwing implements Singer { n = 8; sing(loud: number) { notes += loud; return 8 + loud; } }
class Godwit implements Singer { n = 9; sing = (loud: number) => { notes += 100 * loud; return 9 - loud; }; }
const all: Singer[] = [new Heron(), new Otter(), new Marten(), new Plover(), new Bittern(), new Stoat(), new Curlew(), new Dunlin(), new Lapwing(), new Godwit()];
function hear0(one: Singer) { const before = notes; const got = one.sing(1); return got * 1000 + (notes - before); }
function hear1(one: Singer) { const before = notes; const got = one.sing(2); return got * 1000 + (notes - before); }
function hear2(one: Singer) { const before = notes; const got = one.sing(3); return got * 1000 + (notes - before); }
let sum = 0;
for (const one of all) sum = (sum * 17 + hear0(one) + hear1(one) * 3 + hear2(one) * 5) % 1000003;
console.log(sum, notes);
