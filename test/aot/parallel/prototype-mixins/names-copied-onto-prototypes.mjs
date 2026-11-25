import * as methods from "./mixin-methods.mjs";
import * as again from "./mixin-methods.mjs";

const record = {
  step(k) {
    this.x -= k;
    return this;
  },
  children() {
    return [this.x];
  },
  length: 3,
};

class ByNamespace {
  constructor(x) {
    this.x = x;
    this.link = null;
  }
  base() {
    return this.x;
  }
}
Object.assign(ByNamespace.prototype, methods);

class ByLoop {
  constructor(x) {
    this.x = x;
  }
  twice() {
    return -1;
  }
}
for (const name in record) ByLoop.prototype[name] = record[name];

class ByRecord extends ByLoop {}
const holder = { record };
Object.assign(ByRecord.prototype, holder.record, again);

function ByFunction(x) {
  this.x = x;
}
Object.assign(ByFunction.prototype, methods);
for (const name in record) ByFunction.prototype[name] = record[name];

function query(x) {
  return new ByNamespace(x);
}
Object.assign(query, { fn: ByNamespace.prototype, prototype: ByNamespace.prototype, version: 2 });

const kinds = [ByNamespace, ByLoop, ByRecord, ByFunction];
function call(object, name, ...values) {
  try {
    const answer = object[name](...values);
    return answer === object ? "itself" : String(answer);
  } catch (e) {
    return e.constructor.name;
  }
}
function show(Kind) {
  const p = new Kind(5);
  const answers = [];
  for (const name of ["step", "twice", "next", "label", "shown", "children", "length", "base"])
    answers.push(name + " " + (name in p) + " " + Object.hasOwn(p, name) + " " + call(p, name, 2));
  console.log(Kind.name, p.x, answers.join(", "));
  const names = [];
  for (const name in p) names.push(name);
  console.log(names.join());
}
function steps(Kind) {
  let sum = 0;
  for (let i = 0; i < 50; i++) {
    const p = new Kind(i);
    p.step(1).step(2);
    sum += p.x + (p.twice ? p.twice() : 0);
  }
  return sum;
}
for (let round = 0; round < 3; round++) {
  for (const Kind of kinds) {
    show(Kind);
    console.log(steps(Kind));
  }
  const q = query(round);
  console.log(q instanceof query, query.fn === ByNamespace.prototype, q.step(3).x, Object.keys(query).join());
  if (round === 0) {
    methods.relabel(function () {
      return "relabeled";
    });
    ByNamespace.prototype.twice = function () {
      return "replaced " + this.x;
    };
    record.step = null;
    delete ByLoop.prototype.children;
    query.fn.plugin = function () {
      return "plugin " + this.x;
    };
  }
  const own = new ByNamespace(7);
  own.next = () => "own";
  own.label = 4;
  console.log(call(own, "next"), call(own, "label"), own.label, call(own, "plugin"));
  delete own.next;
  console.log(call(own, "next"), methods.label === again.label, typeof methods.shown, call(methods, "shown"));
}
console.log(Object.keys(methods).join(), new query(1) === undefined, typeof new query(2).base);
