// Property decorators define accessors, or nothing, under names that constructors store: births do not wait for such a field.
const said = [];
const __decorate = (decorators, target, key) => { for (const decorator of decorators) decorator(target, key); };
const observable = (target, key) => {
  const hidden = "_" + key;
  Object.defineProperty(target, key, { get() { return this[hidden]; }, set(value) { this[hidden] = value; }, configurable: true, enumerable: true });
};
const columns = [];
const column = (target, key) => { columns.push(key); };
class Watched {
  constructor(kind, pos) {
    this.pos = pos;
    this.kind = kind;
    this.flags = 0;
    this.parent = undefined;
  }
  getStart() {
    return this.pos;
  }
}
__decorate([observable], Watched.prototype, "flags", void 0);
class Plain {
  constructor(kind, pos) {
    this.pos = pos;
    this.kind = kind;
    this.flags = 0;
    this.parent = undefined;
  }
  getStart() {
    return this.pos;
  }
}
__decorate([column], Plain.prototype, "flags", void 0);
__decorate([column], Plain.prototype, "kind", void 0);
class Element {
  constructor() {
    this.updates = 0;
  }
  requestUpdate() {
    this.updates++;
  }
  static define(key) {
    const hidden = "__" + key;
    Object.defineProperty(this.prototype, key, { get() { return this[hidden]; }, set(value) { this[hidden] = value; this.requestUpdate(); }, configurable: true, enumerable: true });
  }
}
const property = (target, key) => target.constructor.define(key);
class Button extends Element {
  constructor(kind, pos) {
    super();
    this.pos = pos;
    this.kind = kind;
    this.flags = 0;
    this.parent = undefined;
  }
  getStart() {
    return this.pos + this.updates;
  }
}
__decorate([property], Button.prototype, "flags", void 0);
__decorate([property], Button.prototype, "kind", void 0);
let Late = class Late {
  constructor(value) {
    this.value = value;
    this.other = 1;
  }
};
__decorate([], Late.prototype, "value", void 0);
const makers = { Watched: kind => new Watched(kind, 1), Plain: kind => new Plain(kind, 1), Button: kind => new Button(kind, 1) };
function depth(node) {
  let sum = 0;
  while (node) {
    sum += node.kind + node.flags + node.getStart();
    node = node.parent;
  }
  return sum;
}
for (const [name, make] of Object.entries(makers)) {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    let last;
    for (let k = 0; k < 4; k++) {
      const node = make(k);
      node.parent = last;
      if (i & 1) node.flags = k;
      last = node;
    }
    sum += depth(last);
  }
  said.push(name, sum, Object.keys(make(1)).join(), JSON.stringify(make(2)), "flags" in make(1), Object.hasOwn(make(1), "flags"));
}
const late = () => {
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    const object = new Late(i);
    sum += object.value + object.other;
  }
  return sum + Object.keys(new Late(1)).join();
};
said.push(late());
__decorate([observable], Late.prototype, "value", void 0);
said.push(late());
delete Late.prototype.value;
said.push(late());
Object.defineProperty(Late.prototype, "other", { value: 2, writable: false, configurable: true });
"use strict";
said.push((() => { try { return late(); } catch (error) { return error.constructor.name; } })(), columns.join());
const own = new Plain(1, 2);
Object.defineProperty(own, "flags", { get() { return 11; }, configurable: true });
said.push(depth(own), Object.keys(own).join());
delete own.flags;
said.push(Object.keys(own).join(), own.flags);
own.flags = 4;
said.push(Object.keys(own).join(), depth(own));
class Heir extends Watched {
  constructor() {
    super(4, 5);
    this.flags = 9;
    this.more = 1;
  }
}
said.push(Object.keys(new Heir()).join(), depth(new Heir()), Reflect.construct(Watched, [1, 2], Heir).flags);
console.log(said.join("\n"));
