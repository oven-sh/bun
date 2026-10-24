// What a call does to its operands is what the callee OF THAT MOMENT does. A variable that holds a function is stored to, a method is replaced on the prototype, on the instance, on the class; a function declaration is assigned; an accessor takes the place of a method. The first callee keeps nothing and answers a fresh object; its successor keeps everything.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Thing {
  n: number;
  tag: string;
}
const kept: Thing[] = [];
const keeper = (t: Thing): number => {
  kept.push(t);
  return -t.n;
};

// A `let` that holds a function.
let inVariable = (t: Thing): number => t.n;
function callsVariable(i: number): number {
  return inVariable({ n: i, tag: "variable" + i });
}
// A function declaration that is assigned.
function declared(t: Thing): number {
  return t.n;
}
function callsDeclared(i: number): number {
  return declared({ n: i, tag: "declared" + i });
}
// A method on the prototype.
class Service {
  handle(t: Thing): number {
    return t.n;
  }
  static make(i: number): Thing {
    return { n: i, tag: "static fresh" + i };
  }
}
function callsMethod(service: Service, i: number): number {
  return service.handle({ n: i, tag: "method" + i });
}
// A method that one instance gets for itself.
function callsOnInstance(service: Service, i: number): number {
  return service.handle({ n: i, tag: "instance" + i });
}
// A field that holds a function.
const withField = { handle: (t: Thing): number => t.n };
function callsField(i: number): number {
  return withField.handle({ n: i, tag: "field" + i });
}
// An element of an array of functions.
const handlers: ((t: Thing) => number)[] = [t => t.n, t => t.n + 1];
function callsElement(i: number): number {
  return handlers[i & 1]({ n: i, tag: "element" + i });
}
// A static factory whose answer was fresh.
const pool: Thing = { n: 0, tag: "the pooled one" };
function usesFactory(i: number): number {
  const made = Service.make(i);
  made.n += 1;
  return made.n;
}
// A function captured by a closure that a setter function replaces.
function makePair() {
  let current = (t: Thing): number => t.n;
  return {
    call: (i: number) => current({ n: i, tag: "captured" + i }),
    replace: (f: (t: Thing) => number) => {
      current = f;
    },
  };
}
const pair = makePair();
const service = new Service();
const special = new Service();
function round(i: number): number {
  return callsVariable(i) + callsDeclared(i) + callsMethod(service, i) + callsOnInstance(special, i) + callsField(i) + callsElement(i) + usesFactory(i) + pair.call(i);
}
let sum = 0;
for (let i = 0; i < 500; i++) sum += round(i);
console.log(sum, kept.length);
inVariable = keeper;
// @ts-ignore: a function declaration is a variable
declared = keeper;
Service.prototype.handle = keeper;
withField.handle = keeper;
handlers[1] = keeper;
Service.make = () => pool;
pair.replace(keeper);
for (let i = 500; i < 503; i++) sum += round(i);
console.log(sum, churn(60), kept.map(t => t.tag).join(), pool.n);
kept.length = 0;
special.handle = t => {
  kept.push(t, t);
  return 0;
};
delete (Service.prototype as Partial<Service>).handle;
Object.defineProperty(Service.prototype, "handle", {
  get() {
    kept.push({ n: -1, tag: "the getter ran on " + (this === service ? "service" : "another") });
    return (t: Thing) => t.n * 2;
  },
  configurable: true,
});
console.log(callsMethod(service, 7), callsOnInstance(special, 8), churn(40), kept.map(t => t.tag).join());

// The replacement happens in the middle of the call that passes the object: an argument's evaluation replaces the callee.
let late = (a: Thing, b: number): string => "first callee " + a.tag + b;
function replaceAndAnswer(): number {
  late = (a, b) => {
    kept.push(a);
    return "second callee " + a.tag + b;
  };
  return 1;
}
console.log(late({ n: 0, tag: "x" }, replaceAndAnswer()), late({ n: 0, tag: "y" }, 2));
const host = {
  run(a: Thing, b: number): string {
    return "first method " + a.tag + b;
  },
};
function replaceMethod(): number {
  host.run = (a, b) => "second method " + a.tag + b;
  return 1;
}
console.log(host.run({ n: 0, tag: "x" }, replaceMethod()), host.run({ n: 0, tag: "y" }, 2));

// The callee replaces itself on its first call.
let lazy = (t: Thing): Thing => {
  const memo = t;
  lazy = () => memo;
  return { n: t.n, tag: "fresh copy of " + t.tag };
};
const answers: Thing[] = [];
for (let i = 0; i < 4; i++) answers.push(lazy({ n: i, tag: "lazy" + i }));
console.log(churn(40), answers.map(t => t.tag).join(), answers[1] === answers[2], answers[0] === answers[1]);
