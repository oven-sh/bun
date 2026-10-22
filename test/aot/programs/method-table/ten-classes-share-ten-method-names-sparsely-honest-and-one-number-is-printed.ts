// Ten classes that are no relatives share ten method names sparsely: each class has between two and five of them. Each name has a call site of its own, typed by an interface with that one method, which sees exactly the classes that have it. Nothing is changed. One number is printed.
interface HasA {
  a(): number;
}
interface HasB {
  b(): number;
}
interface HasC {
  c(): number;
}
interface HasD {
  d(): number;
}
interface HasE {
  e(): number;
}
interface HasF {
  f(): number;
}
interface HasG {
  g(): number;
}
interface HasH {
  h(): number;
}
interface HasI {
  i(): number;
}
interface HasJ {
  j(): number;
}
class C0 {
  id = 1;
  a(): number {
    return this.id * 10 + 0;
  }
  c(): number {
    return this.id * 10 + 2;
  }
  f(): number {
    return this.id * 10 + 5;
  }
  j(): number {
    return this.id * 10 + 9;
  }
}
class C1 {
  id = 2;
  b(): number {
    return this.id * 10 + 1;
  }
  c(): number {
    return this.id * 10 + 2;
  }
  g(): number {
    return this.id * 10 + 6;
  }
}
class C2 {
  id = 3;
  a(): number {
    return this.id * 10 + 0;
  }
  d(): number {
    return this.id * 10 + 3;
  }
  e(): number {
    return this.id * 10 + 4;
  }
  h(): number {
    return this.id * 10 + 7;
  }
}
class C3 {
  id = 4;
  f(): number {
    return this.id * 10 + 5;
  }
  g(): number {
    return this.id * 10 + 6;
  }
  i(): number {
    return this.id * 10 + 8;
  }
  j(): number {
    return this.id * 10 + 9;
  }
}
class C4 {
  id = 5;
  a(): number {
    return this.id * 10 + 0;
  }
  b(): number {
    return this.id * 10 + 1;
  }
  i(): number {
    return this.id * 10 + 8;
  }
}
class C5 {
  id = 6;
  c(): number {
    return this.id * 10 + 2;
  }
  d(): number {
    return this.id * 10 + 3;
  }
  f(): number {
    return this.id * 10 + 5;
  }
  h(): number {
    return this.id * 10 + 7;
  }
}
class C6 {
  id = 7;
  b(): number {
    return this.id * 10 + 1;
  }
  e(): number {
    return this.id * 10 + 4;
  }
  g(): number {
    return this.id * 10 + 6;
  }
  j(): number {
    return this.id * 10 + 9;
  }
}
class C7 {
  id = 8;
  a(): number {
    return this.id * 10 + 0;
  }
  h(): number {
    return this.id * 10 + 7;
  }
}
class C8 {
  id = 9;
  c(): number {
    return this.id * 10 + 2;
  }
  e(): number {
    return this.id * 10 + 4;
  }
  f(): number {
    return this.id * 10 + 5;
  }
  i(): number {
    return this.id * 10 + 8;
  }
}
class C9 {
  id = 10;
  b(): number {
    return this.id * 10 + 1;
  }
  d(): number {
    return this.id * 10 + 3;
  }
  g(): number {
    return this.id * 10 + 6;
  }
  h(): number {
    return this.id * 10 + 7;
  }
  j(): number {
    return this.id * 10 + 9;
  }
}

function callA(list: HasA[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.a();
  return sum;
}
function callB(list: HasB[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.b();
  return sum;
}
function callC(list: HasC[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.c();
  return sum;
}
function callD(list: HasD[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.d();
  return sum;
}
function callE(list: HasE[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.e();
  return sum;
}
function callF(list: HasF[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.f();
  return sum;
}
function callG(list: HasG[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.g();
  return sum;
}
function callH(list: HasH[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.h();
  return sum;
}
function callI(list: HasI[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.i();
  return sum;
}
function callJ(list: HasJ[]): number {
  let sum = 0;
  for (const x of list) sum = sum * 3 + x.j();
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

note(callA([new C0(), new C2(), new C4(), new C7()]));
note(callB([new C1(), new C4(), new C6(), new C9()]));
note(callC([new C0(), new C1(), new C5(), new C8()]));
note(callD([new C2(), new C5(), new C9()]));
note(callE([new C2(), new C6(), new C8()]));
note(callF([new C0(), new C3(), new C5(), new C8()]));
note(callG([new C1(), new C3(), new C6(), new C9()]));
note(callH([new C2(), new C5(), new C7(), new C9()]));
note(callI([new C3(), new C4(), new C8()]));
note(callJ([new C0(), new C3(), new C6(), new C9()]));
console.log(checksum);

export {};
