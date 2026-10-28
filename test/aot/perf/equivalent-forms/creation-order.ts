// Pairs of loops that construct the same objects; the constructors store the same members in another order. ../equivalent-forms.test.ts says which pairs it holds together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

class InDeclaredOrder {
  a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number;
  constructor(n: number) {
    this.a = n; this.b = n + 1; this.c = n + 2; this.d = n + 3; this.e = n + 4; this.f = n + 5; this.g = n + 6; this.h = n + 7;
  }
}
class InReverseOrder {
  a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number;
  constructor(n: number) {
    this.h = n + 7; this.g = n + 6; this.f = n + 5; this.e = n + 4; this.d = n + 3; this.c = n + 2; this.b = n + 1; this.a = n;
  }
}
class WithUndeclaredMemberLast {
  a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number;
  constructor(n: number) {
    this.a = n; this.b = n + 1; this.c = n + 2; this.d = n + 3; this.e = n + 4; this.f = n + 5; this.g = n + 6; this.h = n + 7;
    (this as any).extra = n;
  }
}
class WithUndeclaredMemberFirst {
  a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number;
  constructor(n: number) {
    (this as any).extra = n;
    this.a = n; this.b = n + 1; this.c = n + 2; this.d = n + 3; this.e = n + 4; this.f = n + 5; this.g = n + 6; this.h = n + 7;
  }
}
class InOneOrder {
  a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number;
  constructor(n: number, early: boolean) {
    if (early) { this.a = n; this.b = n + 1; this.c = n + 2; this.d = n + 3; } else { this.a = n + 1; this.b = n; this.c = n + 3; this.d = n + 2; }
    this.e = n + 4; this.f = n + 5; this.g = n + 6; this.h = n + 7;
  }
}
class InTwoOrders {
  a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number;
  constructor(n: number, early: boolean) {
    if (early) { this.a = n; this.b = n + 1; this.c = n + 2; this.d = n + 3; } else { this.b = n; this.a = n + 1; this.d = n + 2; this.c = n + 3; }
    this.e = n + 4; this.f = n + 5; this.g = n + 6; this.h = n + 7;
  }
}

const kept: { a: number; h: number }[] = [];
function keep(object: { a: number; h: number }, i: number) {
  kept[i & 7] = object;
  return object.a + object.h;
}

const loops: Record<string, (n: number) => number> = {
  "members stored in the order of their declarations": n => { let sum = 0; for (let i = 0; i < n; i++) sum += keep(new InDeclaredOrder(i & 15), i); return sum; },
  "members stored in the reverse order": n => { let sum = 0; for (let i = 0; i < n; i++) sum += keep(new InReverseOrder(i & 15), i); return sum; },
  "an undeclared member stored last": n => { let sum = 0; for (let i = 0; i < n; i++) sum += keep(new WithUndeclaredMemberLast(i & 15), i); return sum; },
  "an undeclared member stored first": n => { let sum = 0; for (let i = 0; i < n; i++) sum += keep(new WithUndeclaredMemberFirst(i & 15), i); return sum; },
  "two arms that store in one order": n => { let sum = 0; for (let i = 0; i < n; i++) sum += keep(new InOneOrder(i & 15, (i & 1) === 0), i); return sum; },
  "two arms that store in two orders": n => { let sum = 0; for (let i = 0; i < n; i++) sum += keep(new InTwoOrders(i & 15, (i & 1) === 0), i); return sum; },
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
if (!which) console.log(kept.map(object => Object.keys(object).join("")).join(" "));
