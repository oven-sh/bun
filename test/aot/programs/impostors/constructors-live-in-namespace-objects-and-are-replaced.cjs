function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

var Shop = Shop || {};
Shop.models = {};

Shop.Item = function (title, cost) {
  this.title = title;
  this.cost = cost;
};
Shop.Item.prototype.label = function () {
  return this.title + " for " + this.cost;
};
Shop.Item.create = function (title, cost) {
  return new Shop.Item(title, cost);
};

Shop.models.Basket = function () {
  this.items = [];
};
Shop.models.Basket.prototype.add = function (title, cost) {
  this.items.push(new Shop.Item(title, cost));
  return this;
};
Shop.models.Basket.prototype.total = function () {
  var total = 0;
  for (var i = 0; i < this.items.length; i++) total += this.items[i].cost;
  return total;
};

function makeItem(title, cost) {
  return new Shop.Item(title, cost);
}

function labelOf(item) {
  return item.label();
}

function costOf(item) {
  return item.cost;
}

function fillBasket() {
  return new Shop.models.Basket().add("pen", 2).add("ink", 3);
}

function look(phase) {
  attempt(phase + ": new Shop.Item", function () { return makeItem("pen", 2); });
  attempt(phase + ": label()", function () { return labelOf(makeItem("pen", 2)); });
  attempt(phase + ": cost", function () { return costOf(makeItem("pen", 2)); });
  attempt(phase + ": Shop.Item.create", function () { return Shop.Item.create("pen", 2); });
  attempt(phase + ": a basket's total", function () { return fillBasket().total(); });
  attempt(phase + ": instanceof the first Item", function () { return makeItem("pen", 2) instanceof FirstItem; });
}

var FirstItem = Shop.Item;
var sum = 0;
for (var i = 0; i < 2000; i++) sum += labelOf(makeItem("pen", i % 5)).length + costOf(makeItem("ink", i % 7)) + fillBasket().total();
console.log("2000 honest rounds", sum);
look("untouched");

Shop.Item = function (title, cost) {
  this.cost = "cost first: " + cost;
  this.title = title;
};
Shop.Item.prototype.label = function () {
  return "second item " + this.title;
};
look("Shop.Item was replaced by a function with the fields the other way round");

Shop.Item = class {
  constructor(title, cost) {
    this.title = title;
    this.cost = cost * 100;
  }
  label() {
    return "a class item " + this.title;
  }
  static create() {
    return "created by the class";
  }
};
look("Shop.Item was replaced by a class");

Shop.Item = FirstItem.bind(null, "bound title");
look("Shop.Item was replaced by a bound function");

Shop.Item = function () {
  return { title: "returned", cost: -1, label: function () { return "a returned literal"; } };
};
look("Shop.Item was replaced by a function that returns a literal");

Shop[["It", "em"].join("")] = function (title, cost) {
  this.extra = true;
  this.title = title;
  this.cost = String(cost);
};
look("Shop.Item was replaced under a joined name");

Shop.Item = function () {};
Shop.Item.prototype = FirstItem.prototype;
look("Shop.Item was replaced by an empty function with the first prototype");

Shop.Item = 5;
look("Shop.Item is a number");

delete Shop.Item;
look("Shop.Item was deleted");

Object.defineProperty(Shop, "Item", { get: function () { return FirstItem; }, configurable: true });
look("Shop.Item is a getter that answers the first one");

delete Shop.Item;
Shop.Item = FirstItem;
look("the first one is back");

var OldShop = Shop;
Shop = { Item: function (title) { this.title = "from another shop: " + title; }, models: OldShop.models };
Shop.Item.prototype.label = function () { return this.title; };
look("the variable Shop holds another object");
Shop = OldShop;
look("at the end");
