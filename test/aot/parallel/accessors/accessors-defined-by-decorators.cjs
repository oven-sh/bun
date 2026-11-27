// Property decorators define accessors, or nothing, under names that constructors store: births do not wait for such a field.
const said = [];
const __decorate = (decorators, target, key) => { for (const decorator of decorators) decorator(target, key); };
const underscored = (target, key) => {
  const hidden = "_" + key;
  Object.defineProperty(target, key, { get() { return this[hidden]; }, set(value) { this[hidden] = value; }, configurable: true, enumerable: true });
};
const lists = [];
const listed = (target, key) => { lists.push(key); };
class Watched {
  constructor(wood, legs) {
    this.below = undefined;
    this.nails = 0;
    this.wood = wood;
    this.legs = legs;
  }
  feet() {
    return this.legs;
  }
}
__decorate([underscored], Watched.prototype, "nails", void 0);
class Plain {
  constructor(wood, legs) {
    this.below = undefined;
    this.nails = 0;
    this.wood = wood;
    this.legs = legs;
  }
  feet() {
    return this.legs;
  }
}
__decorate([listed], Plain.prototype, "nails", void 0);
__decorate([listed], Plain.prototype, "wood", void 0);
class Basket {
  constructor() {
    this.counts = 0;
  }
  recount() {
    this.counts++;
  }
  static weave(key) {
    const inside = "kept " + key;
    Object.defineProperty(this.prototype, key, { enumerable: true, configurable: true, set(value) { this.recount(); this[inside] = value; }, get() { return this[inside]; } });
  }
}
const woven = (target, key) => target.constructor.weave(key);
class Hamper extends Basket {
  constructor(wood, legs) {
    super();
    this.below = undefined;
    this.nails = 0;
    this.wood = wood;
    this.legs = legs;
  }
  feet() {
    return this.legs + this.counts;
  }
}
__decorate([woven], Hamper.prototype, "nails", void 0);
__decorate([woven], Hamper.prototype, "wood", void 0);
let Late = class Late {
  constructor(value) {
    this.value = value;
    this.other = 1;
  }
};
__decorate([], Late.prototype, "value", void 0);
const makers = { Watched: wood => new Watched(wood, 1), Plain: wood => new Plain(wood, 1), Hamper: wood => new Hamper(wood, 1) };
function depth(stool) {
  let sum = 0;
  while (stool) {
    sum += stool.wood + stool.nails + stool.feet();
    stool = stool.below;
  }
  return sum;
}
for (const [name, make] of Object.entries(makers)) {
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    let last;
    for (let k = 0; k < 4; k++) {
      const stool = make(k);
      stool.below = last;
      if (i & 1) stool.nails = k;
      last = stool;
    }
    sum += depth(last);
  }
  said.push(name, sum, Object.keys(make(1)).join(), JSON.stringify(make(2)), "nails" in make(1), Object.hasOwn(make(1), "nails"));
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
__decorate([underscored], Late.prototype, "value", void 0);
said.push(late());
delete Late.prototype.value;
said.push(late());
Object.defineProperty(Late.prototype, "other", { value: 2, writable: false, configurable: true });
"use strict";
said.push((() => { try { return late(); } catch (error) { return error.constructor.name; } })(), lists.join());
const own = new Plain(1, 2);
Object.defineProperty(own, "nails", { get() { return 11; }, configurable: true });
said.push(depth(own), Object.keys(own).join());
delete own.nails;
said.push(Object.keys(own).join(), own.nails);
own.nails = 4;
said.push(Object.keys(own).join(), depth(own));
class Heir extends Watched {
  constructor() {
    super(4, 5);
    this.nails = 9;
    this.more = 1;
  }
}
said.push(Object.keys(new Heir()).join(), depth(new Heir()), Reflect.construct(Watched, [1, 2], Heir).nails);
console.log(said.join("\n"));
