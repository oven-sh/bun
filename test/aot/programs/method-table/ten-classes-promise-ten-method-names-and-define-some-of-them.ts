// Ten classes that are no relatives define some of ten method names each, and an interface merged with each class promises all ten. Every name is called on every class: the calls for which there is a method answer, and the others throw a TypeError and run nothing else.
interface All {
  a(): number;
  b(): number;
  c(): number;
  d(): number;
  e(): number;
  f(): number;
  g(): number;
  h(): number;
  i(): number;
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
interface C0 extends All {}
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
interface C1 extends All {}
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
interface C2 extends All {}
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
interface C3 extends All {}
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
interface C4 extends All {}
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
interface C5 extends All {}
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
interface C6 extends All {}
class C7 {
  id = 8;
  a(): number {
    return this.id * 10 + 0;
  }
  h(): number {
    return this.id * 10 + 7;
  }
}
interface C7 extends All {}
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
interface C8 extends All {}
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
interface C9 extends All {}

function callA(x: All): number {
  return x.a();
}
function callB(x: All): number {
  return x.b();
}
function callC(x: All): number {
  return x.c();
}
function callD(x: All): number {
  return x.d();
}
function callE(x: All): number {
  return x.e();
}
function callF(x: All): number {
  return x.f();
}
function callG(x: All): number {
  return x.g();
}
function callH(x: All): number {
  return x.h();
}
function callI(x: All): number {
  return x.i();
}
function callJ(x: All): number {
  return x.j();
}

function attempt(call: (x: All) => number, x: All): number {
  try {
    return call(x);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const all: All[] = [new C0(), new C1(), new C2(), new C3(), new C4(), new C5(), new C6(), new C7(), new C8(), new C9()];
for (const x of all) {
  note("a", attempt(callA, x));
  note("b", attempt(callB, x));
  note("c", attempt(callC, x));
  note("d", attempt(callD, x));
  note("e", attempt(callE, x));
  note("f", attempt(callF, x));
  note("g", attempt(callG, x));
  note("h", attempt(callH, x));
  note("i", attempt(callI, x));
  note("j", attempt(callJ, x));
}

export {};
