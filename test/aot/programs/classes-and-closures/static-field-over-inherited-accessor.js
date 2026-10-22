// A static field hides an accessor of the base class. Before its initializer has run and after it is deleted, reads and stores of the field run that accessor, and what the accessor changes is visible at once.
let calls = 0;

class A {
  static get f() {
    calls++;
    return 1;
  }
  static set f(value) {
    calls += 10;
  }
}

class B extends A {
  static early = [B.f, calls, B.f, calls, (B.f = 3), calls].join();
  static f = 2;
}

function read() {
  const before = calls;
  const first = B.f;
  const between = calls;
  const second = B.f;
  return [first, second, between - before, calls - between].join();
}

function store(value) {
  const before = calls;
  B.f = value;
  return [calls - before, Object.hasOwn(B, "f")].join();
}

console.log("before the initializer: " + B.early);
console.log("defined: " + [read(), store(4), read()].join(" | "));
console.log("deleted: " + delete [B][0].f);
console.log("absent: " + [read(), store(5), read()].join(" | "));
