// A getter changes the object while it is being read.
interface Triple {
  a: number;
  b: number;
  c: number;
}

function total(t: Triple): string {
  return t.a + "," + t.b + "," + t.c;
}

function totalTwice(t: Triple): string {
  return total(t) + " then " + total(t);
}

function listing(t: Triple): string {
  return Object.keys(t).join() + " " + JSON.stringify(t);
}

function deletesTheNext(): Triple {
  const target: Triple = {
    get a() {
      Reflect.deleteProperty(target, "b");
      return 1;
    },
    b: 2,
    c: 3,
  };
  return target;
}

function rewritesTheNext(): Triple {
  const target: Triple = {
    get a() {
      target.b = 20;
      target.c = 30;
      return 1;
    },
    b: 2,
    c: 3,
  };
  return target;
}

function reordersTheRest(): Triple {
  const target: Triple = {
    get a() {
      const { b, c } = target;
      Reflect.deleteProperty(target, "b");
      Reflect.deleteProperty(target, "c");
      Object.assign(target, { extra: 0, c: c + 100, b: b + 100 });
      return 1;
    },
    b: 2,
    c: 3,
  };
  return target;
}

function becomesPlain(): Triple {
  const target: Triple = {
    get a() {
      Object.defineProperty(target, "a", { value: 11, writable: true, enumerable: true, configurable: true });
      return 1;
    },
    b: 2,
    c: 3,
  };
  return target;
}

function changesThePrototype(): Triple {
  const target: Triple = Object.assign(Object.create({ c: 3 }), {
    get a(): number {
      return 0;
    },
    b: 2,
  });
  Object.defineProperty(target, "a", {
    get() {
      Object.setPrototypeOf(target, { c: 33 });
      return 1;
    },
    enumerable: true,
    configurable: true,
  });
  return target;
}

function turnsTheNextIntoAGetter(): Triple {
  const target: Triple = {
    get a() {
      Object.defineProperty(target, "b", { get: () => 22, enumerable: true, configurable: true });
      return 1;
    },
    b: 2,
    c: 3,
  };
  return target;
}

function growsALot(): Triple {
  const target: Triple = {
    get a() {
      const extras: Record<string, number> = {};
      for (let i = 0; i < 100; i++) extras["k" + i] = i;
      Object.assign(target, extras);
      return 1;
    },
    b: 2,
    c: 3,
  };
  return target;
}

const makers: [string, () => Triple][] = [
  ["plain", () => ({ a: 1, b: 2, c: 3 })],
  ["deletes the next member", deletesTheNext],
  ["rewrites the next members", rewritesTheNext],
  ["reorders the rest", reordersTheRest],
  ["becomes a plain member", becomesPlain],
  ["changes the prototype", changesThePrototype],
  ["turns the next member into a getter", turnsTheNextIntoAGetter],
  ["adds a hundred members", growsALot],
];

for (const [label, make] of makers) {
  console.log(label + ", read in order: " + totalTwice(make()));
  console.log(label + ", pattern: " + (({ a, b, c }: Triple) => a + "," + b + "," + c)(make()));
  console.log(label + ", json: " + JSON.stringify(make()).slice(0, 60));
  console.log(label + ", spread: " + JSON.stringify({ ...make() }).slice(0, 60));
  console.log(label + ", entries: " + Object.entries(make()).join("|").slice(0, 60));
  const walked: string[] = [];
  const subject = make();
  for (const key in subject) {
    walked.push(key);
    subject.a;
  }
  console.log(label + ", for-in that reads a: " + walked.slice(0, 6).join());
  const after = make();
  after.a;
  console.log(label + ", afterwards: " + listing(after).slice(0, 70));
}

const plain: Triple = { a: 1, b: 2, c: 3 };
let length = 0;
for (let i = 0; i < 2000; i++) length += total(plain).length;
console.log("2000 honest: " + length);
for (const [label, make] of makers) console.log("then " + label + ": " + total(make()));

export {};
