// new Root() is a prototype that the build follows, although Root only hands its arguments to a method that does nothing with its object; then the method does something with it, and prototypes lose what they had.
"use strict";
var Shop = {};
Shop.Item = function () {
  this.open.apply(this, arguments);
};
Shop.Item.prototype.open = function () {};
Shop.Item.prototype.cost = function () {
  return 1;
};
Shop.Item.prototype.both = function () {
  return this.cost() * 2 + this.weight;
};
Shop.Item.prototype.weight = 3;
Shop.Book = function () {
  this.open.apply(this, arguments);
};
Shop.Book.prototype = new Shop.Item();
Shop.Book.prototype.open = function (pages, price) {
  this.pages = pages;
  this.price = price;
};
Shop.Book.prototype.cost = function () {
  return this.price + this.pages / 100;
};
Shop.Map = function () {
  this.open.apply(this, arguments);
};
Shop.Map.prototype = new Shop.Book();
Shop.Map.prototype.open = function (folds) {
  Shop.Book.prototype.open.call(this, folds * 2, 7);
  this.folds = folds;
};
Shop.Map.prototype.weight = 1;
function sum(items) {
  let all = 0;
  for (const item of items) all += item.both() + item.cost();
  return all;
}
for (let round = 0; round < 30; round++) {
  const items = [new Shop.Book(100 + round, 5), new Shop.Map(round), new Shop.Item(round), new Shop.Book(50, round)];
  const all = sum(items);
  if (round % 9 === 0) console.log(round, all, Object.keys(items[1]).join(), items[1] instanceof Shop.Book, items[0] instanceof Shop.Map);
}
console.log(Object.keys(Shop.Book.prototype).join(), Shop.Map.prototype.pages, Shop.Book.prototype.constructor === Shop.Item, Object.keys(new Shop.Item(1, 2)).length);
console.log(String(new Shop.Book().pages), new Shop.Book("9", null).cost(), new Shop.Map("3").pages);
Shop.Item.prototype.open = function (first) {
  this.first = first;
};
console.log(new Shop.Item(8).first, Object.keys(new Shop.Item(8)).join(), new Shop.Book(1, 2).first);
Shop.Book.prototype.cost = () => 1000;
delete Shop.Map.prototype.weight;
console.log(sum([new Shop.Book(1, 1), new Shop.Map(1)]));
Object.setPrototypeOf(Shop.Map.prototype, { both: () => -1, cost: () => -2 });
try {
  console.log(sum([new Shop.Map(4)]));
} catch (error) {
  console.log(error.constructor.name);
}
Shop.Map.prototype.open = null;
try {
  new Shop.Map(1);
} catch (error) {
  console.log(error.constructor.name);
}
