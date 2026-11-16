// What a getter returns is called under the getter's name, on objects of classes that escape: the call goes by what the program's own code laid under the name, and by whatever else lies there.
// Under: --aot-check=FlowFixpoint: a call that knew a getter's closure alone gave it up where the class had escaped in between, and the flow was not closed.
"use strict";
const J = JSON.parse('{"k":"add","m":"mul","name":"fn","no":"none","z":-0,"one":1}');
const F = { add(a, b) { return a + b; }, mul(a, b) { return a * b; } };
class C { get fn() { return F[J.k]; } }
console.log(new C().fn(1, 2), Object.is(new C().fn(J.z, J.z), -0), new C().fn("a", 1));

class S { static get fn() { return F[J.m]; } get gn() { return F[J.k]; } }
console.log(S.fn(3, 4), new S().gn(5, 6), Object.is(S.fn(J.z, J.one), -0));

class E { get fn() { return F[J.k]; } }
class Below extends E { get other() { return super.fn; } }
const e = new E(), below = new Below();
console.log(e.fn(1, 2), below.fn(1, 2), below.other(3, 4));
Object.defineProperty(E.prototype, J.name, { get() { return F[J.m]; }, configurable: true });
console.log(e.fn(5, 7), below.fn(5, 7), below.other(5, 7));
Object.defineProperty(E.prototype, J.name, { value: 5, configurable: true });
for (const call of [() => e.fn(1, 2), () => below.other(1, 2)]) {
  try { call(); console.log("called"); } catch (error) { console.log(error instanceof TypeError); }
}
Object.defineProperty(E.prototype, J.name, { value: F.add });
console.log(e.fn(8, 9), below.fn(8, 9));

class N { get fn() { return F[J.no]; } }
try { new N().fn(1, 2); console.log("called"); } catch (error) { console.log(error instanceof TypeError); }

class T { constructor(n) { this.n = n; } get fn() { return this.n & 1 ? F[J.k] : F[J.m]; } }
const things = [];
for (let i = 0; i < 20; i++) things.push(new T(i));
let sum = 1;
for (let turn = 0; turn < 200; turn++) {
  for (let i = 0; i < things.length; i++) sum = things[i].fn(sum, i) % 1000003;
}
console.log(sum, JSON.stringify(things.slice(0, 2)));
