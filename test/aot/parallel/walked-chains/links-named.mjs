const unknown = JSON.parse('{"a":[1,{"b":2}]}');
const kept = [];
class C0 extends Map {
  v0 = 0;
  next() {
    return new C1();
  }
  get g0() {
    return this.v0;
  }
  toJSON() {
    return { k0: this.v0 };
  }
}
class C1 extends Set {
  v1 = 1;
  next() {
    return new C2();
  }
  get g1() {
    return this.v1;
  }
  toJSON() {
    return { k1: this.v1 };
  }
}
class C2 extends Array {
  v2 = 2;
  next() {
    return new C3(0);
  }
  get g2() {
    return this.v2;
  }
  toJSON() {
    return { k2: this.v2 };
  }
}
class C3 extends Date {
  v3 = 3;
  next() {
    return new C4();
  }
  get g3() {
    return this.v3;
  }
  toJSON() {
    return { k3: this.v3 };
  }
}
class C4 extends RegExp {
  v4 = 4;
  next() {
    return new C5(() => {});
  }
  get g4() {
    return this.v4;
  }
  toJSON() {
    return { k4: this.v4 };
  }
}
class C5 extends Promise {
  v5 = 5;
  next() {
    return new C6();
  }
  get g5() {
    return this.v5;
  }
  toJSON() {
    return { k5: this.v5 };
  }
}
class C6 extends Map {
  v6 = 6;
  next() {
    return new C7();
  }
  get g6() {
    return this.v6;
  }
  toJSON() {
    return { k6: this.v6 };
  }
}
class C7 extends Set {
  v7 = 7;
  next() {
    return new C8();
  }
  get g7() {
    return this.v7;
  }
  toJSON() {
    return { k7: this.v7 };
  }
}
class C8 extends Array {
  v8 = 8;
  next() {
    return new C9(0);
  }
  get g8() {
    return this.v8;
  }
  toJSON() {
    return { k8: this.v8 };
  }
}
class C9 extends Date {
  v9 = 9;
  next() {
    return new C10();
  }
  get g9() {
    return this.v9;
  }
  toJSON() {
    return { k9: this.v9 };
  }
}
class C10 extends RegExp {
  v10 = 10;
  next() {
    return new C11(() => {});
  }
  get g10() {
    return this.v10;
  }
  toJSON() {
    return { k10: this.v10 };
  }
}
class C11 extends Promise {
  v11 = 11;
  next() {
    return new C12();
  }
  get g11() {
    return this.v11;
  }
  toJSON() {
    return { k11: this.v11 };
  }
}
class C12 extends Map {
  v12 = 12;
  next() {
    return new C13();
  }
  get g12() {
    return this.v12;
  }
  toJSON() {
    return { k12: this.v12 };
  }
}
class C13 extends Set {
  v13 = 13;
  next() {
    return new C14();
  }
  get g13() {
    return this.v13;
  }
  toJSON() {
    return { k13: this.v13 };
  }
}
class C14 extends Array {
  v14 = 14;
  next() {
    return new C15(0);
  }
  get g14() {
    return this.v14;
  }
  toJSON() {
    return { k14: this.v14 };
  }
}
class C15 extends Date {
  v15 = 15;
  next() {
    return new C16();
  }
  get g15() {
    return this.v15;
  }
  toJSON() {
    return { k15: this.v15 };
  }
}
class C16 extends RegExp {
  v16 = 16;
  next() {
    return new C17(() => {});
  }
  get g16() {
    return this.v16;
  }
  toJSON() {
    return { k16: this.v16 };
  }
}
class C17 extends Promise {
  v17 = 17;
  next() {
    return new C18();
  }
  get g17() {
    return this.v17;
  }
  toJSON() {
    return { k17: this.v17 };
  }
}
class C18 extends Map {
  v18 = 18;
  next() {
    return new C19();
  }
  get g18() {
    return this.v18;
  }
  toJSON() {
    return { k18: this.v18 };
  }
}
class C19 extends Set {
  v19 = 19;
  next() {
    return null;
  }
  get g19() {
    return this.v19;
  }
  toJSON() {
    return { k19: this.v19 };
  }
}
unknown.first = new C0();
console.log(String(unknown.a), JSON.stringify(unknown.a));
let sum = 0;
for (let x = unknown.first; x; x = x.next()) {
  kept.push(x);
  for (const key of Object.keys(x)) if (key[0] === "v") sum += x[key];
}
console.log(kept.length, sum);
console.log(kept.map(x => x.constructor.name).join());
