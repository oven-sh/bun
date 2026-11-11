// STATISTIC: MethodCallsThroughTable >= 3
interface Walker { step(by: number): number }
var tally = 0;
class Heron implements Walker { n = 0; step(by: number) { tally += by * 1; return 0; } }
class Otter implements Walker { n = 1; step(by: number) { return 1 + by; } }
class Marten implements Walker { n = 2; step(by: number) { tally += by * 3; return 2; } }
class Plover implements Walker { n = 3; step(by: number) { tally += by * 4; return 3; } }
class Bittern implements Walker { n = 4; step(by: number) { return 4 + by; } }
class Stoat implements Walker { n = 5; step(by: number) { tally += by * 6; return 5; } }
class Curlew implements Walker { n = 6; step(by: number) { tally += by * 7; return 6; } }
class Dunlin implements Walker { n = 7; step(by: number) { return 7 + by; } }
class Lapwing implements Walker { n = 8; step(by: number) { tally += by * 9; return 8; } }
class Godwit implements Walker { n = 9; step(by: number) { tally += by * 10; return 9; } }
const all: Walker[] = [new Heron(), new Otter(), new Marten(), new Plover(), new Bittern(), new Stoat(), new Curlew(), new Dunlin(), new Lapwing(), new Godwit()];
function drive0(one: Walker) { const before = tally; const got = one.step(1); const after = tally; return got * 1000 + (after - before); }
function drive1(one: Walker) { const before = tally; const got = one.step(2); const after = tally; return got * 1000 + (after - before); }
function drive2(one: Walker) { const before = tally; const got = one.step(3); const after = tally; return got * 1000 + (after - before); }
let sum = 0;
for (const one of all) sum = (sum * 7 + drive0(one) + drive1(one) * 3 + drive2(one) * 5) % 1000003;
console.log(sum, tally);
