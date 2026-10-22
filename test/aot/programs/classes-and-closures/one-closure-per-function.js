function f0() { return 0; }
function f1() { return 1; }
function f2() { return 2; }
function f3() { return 3; }
function f4() { return 4; }
function f5() { return 5; }
function f6() { return 6; }
function f7() { return 7; }
function f8() { return 8; }
function f9() { return 9; }
function f10() { return 10; }
function f11() { return 11; }
function f12() { return 12; }
function f13() { return 13; }
function f14() { return 14; }
function f15() { return 15; }
function f16() { return 16; }
function f17() { return 17; }
function f18() { return 18; }
function f19() { return 19; }
function f20() { return 20; }
function f21() { return 21; }
function f22() { return 22; }
function f23() { return 23; }
function f24() { return 24; }
function f25() { return 25; }
function f26() { return 26; }
function f27() { return 27; }
function f28() { return 28; }
function f29() { return 29; }
function f30() { return 30; }
function f31() { return 31; }
function f32() { return 32; }
function f33() { return 33; }
function f34() { return 34; }
function f35() { return 35; }
function f36() { return 36; }
function f37() { return 37; }
function f38() { return 38; }
function f39() { return 39; }

function collect() {
  return [
  f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21,
  f22, f23, f24, f25, f26, f27, f28, f29, f30, f31, f32, f33, f34, f35, f36, f37, f38, f39,
  ];
}

const first = collect();
const second = collect();
console.log(first.length, first.every((f, i) => f === second[i]));

first.forEach((f, i) => {
  f.tag = i * 2;
});

Bun.gc(true);
let sink = null;
for (let i = 0; i < 100000; i++) sink = { i, next: sink && sink.i };
console.log(sink.i);

const third = collect();
console.log(third.every((f, i) => f === first[i]));
console.log(third.every((f, i) => f.tag === i * 2 && f() === i));

try {
  console.log(Early.name);
} catch (error) {
  console.log(error.name);
}

class Early {
  value = 1;
  method() {
    return this.value;
  }
  static create() {
    return new Early();
  }
}

function readEarly() {
  return Early;
}
console.log(readEarly() === Early, Early.name, Object.getOwnPropertyNames(Early.prototype).join());
console.log(Early.create().method());

class Keyed {
  #secret() {
    return 7;
  }
  *[Symbol.iterator]() {
    yield this.#secret();
  }
}

console.log(Keyed.name, Object.getOwnPropertyNames(Keyed.prototype).join(), [...new Keyed()].join());

function makeNested() {
  function nested() {
    return 1;
  }
  return nested;
}
console.log(makeNested() === makeNested());

function makeLiteral() {
  return {
    method() {
      return this;
    },
  };
}
const literalA = makeLiteral();
const literalB = makeLiteral();
console.log(literalA.method === literalB.method, literalA.method() === literalA);
