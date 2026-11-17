const zero = process.argv.length > 99 ? 1 : 0;

class Base {
  constructor(id) {
    this.id = id;
  }
  name() {
    return 'base' + this.id;
  }
}

class A0 extends Base { own0() { return 100 + this.id; } }
class A1 extends Base { own1() { return 100 + this.id; } }
class A2 extends Base { own2() { return 100 + this.id; } }
class A3 extends Base { own3() { return 100 + this.id; } }
class A4 extends Base { own4() { return 100 + this.id; } }
class A5 extends Base { own5() { return 100 + this.id; } }
class A6 extends Base { own6() { return 100 + this.id; } }
class A7 extends Base { own7() { return 100 + this.id; } }
class A8 extends Base { own8() { return 100 + this.id; } }
class A9 extends Base { own9() { return 100 + this.id; } }
class A10 extends Base { own10() { return 100 + this.id; } }
class A11 extends Base { own11() { return 100 + this.id; } }

const first = new A0(0);
const eleventh = new A11(11);
const five = new A5(5);
const list = [first, new A1(1), new A2(2), new A3(3), new A4(4), five, new A6(6), new A7(7), new A8(8), new A9(9), new A10(10), eleventh];
let calls = 0;
let sum = 0;
let zeros = 0;
let turns = 0;

function note(got) {
  if (got) {
    calls++;
    sum += got;
  } else
    zeros++;
}

const big = 1 / zero;

five[big] = function () {
  return this.id * 10 + 7;
};

function ask(x) {
  return x.Infinity ? x.Infinity() : 0;
}

for (let turn = 0; turn < 40; turn++) {
  for (const x of list)
    note(ask(x));
  turns++;
}

console.log("SAID", calls, sum, zeros, list.length, first.own0(), eleventh.own11(), list[3].name(), 'Infinity' in list[5], 'Infinity' in list[4], turns, big > 1);
