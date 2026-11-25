"use strict";
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));

function Dish() {
  this.grams = 0;
}
Dish.prototype.again = function () {
  return null;
};
Dish.prototype.price = function () {
  return this.grams;
};
Dish.prototype.pour = function (into) {
  into.grams = this.grams;
};
function below(kind, members) {
  kind.prototype = Object.create(Dish.prototype);
  for (const name of Object.keys(members)) kind.prototype[name] = members[name];
  kind.prototype.constructor = kind;
}
function Soup(grams) {
  this.pot = { lids: grams };
  this.grams = grams;
}
below(Soup, {
  price() { return this.pot.lids + this.grams / 4; },
  pour(into) { into.pot.lids = this.pot.lids; into.grams = this.grams; },
  again() { const bowl = new Soup(1); this.pour(bowl); return bowl; },
});
function Cake(slices) {
  this.slices = slices;
}
below(Cake, {
  price() { return this.slices * 7 - 1; },
  again() { const cake = new Cake(2); this.pour(cake); return cake; },
  pour(into) { into.slices = this.slices; },
});
function Water() {}
below(Water, {});

function pick(i) {
  switch (i % 4) {
    case 0: return Soup;
    case 1: return Cake;
    case 2: return Water;
    default: return Dish;
  }
}
const seen = [];
function Table() {
  this.dish = null;
}
Table.prototype.serve = function (order) {
  this.dish = order.dish.again();
};
const run = count => {
  const order = { dish: null };
  const table = new Table();
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const Kind = pick(i);
    order.dish = new Kind(i);
    table.serve(order);
    if (order.dish instanceof Kind) sum += 0.25;
    sum += order.dish.constructor === Kind ? 1 : 0.5;
    if (order.dish instanceof pick(i + 1)) sum += 100;
    if (table.dish) sum += table.dish.price() || 0;
  }
  return sum;
};
tell(run(8), run(60));

Water.prototype.again = function () {
  seen.push(Object.keys(this).length, this instanceof Water);
  return this;
};
tell(run(8), seen.join());

const makers = [Soup, Cake, Water, Dish].map(kind => value => new kind(value));
let total = 0;
for (let i = 0; i < 24; i++) total += makers[i % 4](i).price() || 0;
tell(total);

Object.defineProperty(Cake, Symbol.hasInstance, {
  value(value) {
    seen.push(this === Cake);
    return value.slices > 2;
  },
});
tell(run(8), seen.length, seen[seen.length - 1]);

Soup.prototype.pour = function (into) {
  into.grams = "g" + this.grams;
};
tell(run(5));
Soup.prototype.pour = function (into) {
  into.grams = this.grams;
  Object.setPrototypeOf(into, Dish.prototype);
};
tell(run(9));
const kinds = [Soup, Cake, Water, Dish, class Late extends Dish {}, function () { return { price: () => 5, again() { return this; } }; }];
total = 0;
for (let i = 0; i < 30; i++) {
  const Kind = kinds[i % 6];
  const made = new Kind(i);
  total += made.price() || 0;
  if (i === 20) kinds[0] = new Proxy(Soup, { construct: (target, [grams]) => new target(grams * 2) });
}
tell(total, kinds.map(kind => kind.name).join());
console.log(lines.join("\n"));
