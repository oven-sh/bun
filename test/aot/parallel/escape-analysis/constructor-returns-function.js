// A constructor returns a function without optimization rounds.
// Flags: --aot-limit=MaxOptimizationRounds:0 --aot-verify-each-pass
class Parent {
  constructor(wantsFunction) {
    if (wantsFunction) return function () {};
    this.p = 1;
  }
}
class Child extends Parent {
  c = 2;
  constructor(wantsFunction) {
    super(wantsFunction);
    this.d = 3;
  }
}

const made = [];
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) {
    for (let k = 0; k < 4; k++) made.push(new Child(k % 2 === 1));
  }
}
for (const o of [made[0], made[1], made[34], made[35]]) console.log(typeof o, Object.keys(o).join(), o.c, o.d, o.p, o instanceof Child);
console.log(made.length, made[1] === made[3], made[1]());
