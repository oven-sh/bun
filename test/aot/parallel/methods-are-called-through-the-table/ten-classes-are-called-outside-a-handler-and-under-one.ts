// STATISTIC: MethodCallsThroughTable >= 2
interface Diver { dive(deep: number): number }
var marks = 0;
class Heron implements Diver { n = 0; dive(deep: number) { if (deep > 2) { marks += 1; throw deep; } return deep + this.n; } }
class Otter implements Diver { n = 1; dive(deep: number) { if (deep > 3) { marks += 2; throw deep; } return deep + this.n; } }
class Marten implements Diver { n = 2; dive(deep: number) { if (deep > 4) { marks += 3; throw deep; } return deep + this.n; } }
class Plover implements Diver { n = 3; dive(deep: number) { if (deep > 5) { marks += 4; throw deep; } return deep + this.n; } }
class Bittern implements Diver { n = 4; dive(deep: number) { if (deep > 6) { marks += 5; throw deep; } return deep + this.n; } }
class Stoat implements Diver { n = 5; dive(deep: number) { if (deep > 7) { marks += 6; throw deep; } return deep + this.n; } }
class Curlew implements Diver { n = 6; dive(deep: number) { if (deep > 8) { marks += 7; throw deep; } return deep + this.n; } }
class Dunlin implements Diver { n = 7; dive(deep: number) { if (deep > 9) { marks += 8; throw deep; } return deep + this.n; } }
class Lapwing implements Diver { n = 8; dive(deep: number) { if (deep > 10) { marks += 9; throw deep; } return deep + this.n; } }
class Godwit implements Diver { n = 9; dive(deep: number) { if (deep > 11) { marks += 10; throw deep; } return deep + this.n; } }
const all: Diver[] = [new Heron(), new Otter(), new Marten(), new Plover(), new Bittern(), new Stoat(), new Curlew(), new Dunlin(), new Lapwing(), new Godwit()];
function plain(one: Diver) { const before = marks; const got = one.dive(1); return got * 100 + (marks - before); }
function guarded(one: Diver, deep: number) { const before = marks; try { return one.dive(deep) * 100 + (marks - before); } catch (error) { return -(marks - before); } }
function plainAgain(one: Diver) { const before = marks; const got = one.dive(2); return got * 100 + (marks - before); }
let sum = 0;
for (const one of all) sum = (sum * 11 + plain(one) + guarded(one, 6) * 3 + guarded(one, 1) * 5 + plainAgain(one) * 7) % 1000003;
console.log(sum, marks);
