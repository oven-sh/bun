function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
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

const leaked = [];
let observer = null;

function Order(item, quantity, price) {
  leaked.push(this);
  if (observer) observer("at the start", this);
  this.item = item;
  if (observer) observer("after item", this);
  if (quantity < 0) throw new RangeError("negative quantity");
  this.quantity = quantity;
  if (observer) observer("after quantity", this);
  if (price === undefined) return;
  this.price = price;
  if (observer) observer("at the end", this);
}
Order.prototype.total = function () {
  return this.quantity * this.price;
};
Order.prototype.summary = function () {
  return this.item + " x" + this.quantity + " at " + this.price;
};

function RushOrder(item, quantity, price) {
  this.rush = true;
  Order.call(this, item, quantity, price);
  this.fee = 5;
}
RushOrder.prototype = Object.create(Order.prototype);
RushOrder.prototype.constructor = RushOrder;
RushOrder.prototype.total = function () {
  return Order.prototype.total.call(this) + this.fee;
};

function totalOf(order) {
  return order.total();
}

function summaryOf(order) {
  return order.summary();
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += totalOf(new Order("pen", i % 4, 2)) + totalOf(new RushOrder("ink", i % 3, 3));
console.log("2000 honest orders each", sum, leaked.length);
leaked.length = 0;

for (const Maker of [Order, RushOrder]) {
  attempt(Maker.name + ": a negative quantity", () => new Maker("pen", -1, 2));
  const half = leaked.pop();
  attempt(Maker.name + ": the half-made order", () => half);
  attempt(Maker.name + ": its total()", () => totalOf(half));
  attempt(Maker.name + ": its summary()", () => summaryOf(half));
  attempt(Maker.name + ": instanceof", () => half instanceof Maker);
  half.price = 2;
  half.quantity = 3;
  attempt(Maker.name + ": finished by hand, in another order", () => half);
  attempt(Maker.name + ": its total() now", () => totalOf(half));

  attempt(Maker.name + ": no price", () => new Maker("pen", 2));
  attempt(Maker.name + ": its total()", () => totalOf(leaked.pop()));

  const seen = [];
  observer = (when, order) => {
    let total;
    try {
      total = totalOf(order);
    } catch (error) {
      total = error.constructor.name;
    }
    seen.push(when + ": " + show(order) + " total " + show(total));
  };
  attempt(Maker.name + ": observed while it is made", () => new Maker("pen", 2, 3));
  observer = null;
  for (const line of seen) console.log("  " + line);

  observer = (when, order) => {
    if (when === "after item") order.price = "stored early";
    if (when === "after quantity") delete order.item;
  };
  attempt(Maker.name + ": an observer stores and deletes while it is made", () => new Maker("pen", 2, 3));
  observer = (when, order) => {
    if (when === "after item") Object.freeze(order);
  };
  attempt(Maker.name + ": an observer freezes it while it is made", () => new Maker("pen", 2, 3));
  observer = (when, order) => {
    if (when === "at the start") Object.setPrototypeOf(order, { total: () => "total of another prototype" });
  };
  attempt(Maker.name + ": an observer moves it while it is made", () => totalOf(new Maker("pen", 2, 3)));
  observer = null;
  leaked.length = 0;
  attempt(Maker.name + ": honest again", () => [totalOf(new Maker("pen", 2, 3)), summaryOf(new Maker("pen", 2, 3))]);
}
