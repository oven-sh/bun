// STATISTIC: MethodCallsThroughTable >= 1
interface Coin { worth(): number }
class C1 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 1; } }
class C2 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 2; } }
class C3 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 3; } }
class C4 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 4; } }
class C5 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 5; } }
class C6 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 6; } }
class C7 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 7; } }
class C8 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 8; } }
class C9 implements Coin { constructor(readonly n: number) {} worth() { return this.n + 9; } }
const purse: Coin[] = [new C1(10), new C2(20), new C3(30), new C4(40), new C5(50), new C6(60), new C7(70), new C8(80), new C9(90)];
let sum = 0;
for (let turn = 0; turn < 900; turn++) sum += purse[turn % 9].worth();
console.log(sum);
