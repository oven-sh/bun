function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

class Invoice {
  constructor(customer, amount, paid) {
    this.customer = customer;
    this.amount = amount;
    this.paid = paid;
  }
  status() {
    return this.paid ? "invoice paid" : "invoice open";
  }
}

class Receipt {
  constructor(customer, amount, paid) {
    this.paid = paid;
    this.amount = amount;
    this.customer = customer;
  }
  status() {
    return "receipt for " + this.customer;
  }
}

class Quote {
  amount = "quoted amount";
  customer = "quoted customer";
  paid = "quoted paid";
  status() {
    return "quote";
  }
}

class Refund extends Invoice {
  constructor(customer, amount) {
    super(customer, -amount, true);
    this.reason = "returned";
  }
  status() {
    return "refund, and the parent says " + super.status();
  }
}

function Bill(customer, amount, paid) {
  this.amount = amount;
  this.customer = customer;
  this.paid = paid;
}
Bill.prototype.status = function () {
  return "bill of " + this.amount;
};

function makeRecord(customer, amount, paid) {
  return { customer, amount, paid, status: () => "record" };
}

function makeRecordTheOtherWayRound(customer, amount, paid) {
  return { status: () => "backwards record", paid, amount, customer };
}

function customerOf(paper) {
  return paper.customer;
}

function amountOf(paper) {
  return paper.amount;
}

function paidOf(paper) {
  return paper.paid;
}

function allThree(paper) {
  return [paper.customer, paper.amount, paper.paid];
}

function statusOf(paper) {
  return paper.status();
}

function settle(paper) {
  paper.paid = true;
  paper.amount = 0;
  return paper;
}

function totalOf(papers) {
  let total = 0;
  for (let i = 0; i < papers.length; i++) total += papers[i].amount;
  return total;
}

const makers = [
  ["Invoice", () => new Invoice("ann", 10, false)],
  ["Receipt, the fields in the opposite order", () => new Receipt("bob", 20, false)],
  ["Quote, class fields", () => new Quote()],
  ["Refund, a subclass", () => new Refund("cat", 30)],
  ["Bill, a constructor function", () => new Bill("dan", 40, false)],
  ["a literal", () => makeRecord("eve", 50, false)],
  ["a literal the other way round", () => makeRecordTheOtherWayRound("fay", 60, false)],
];

function look(phase) {
  for (const [label, make] of makers) {
    console.log(phase + " | " + label + " | customer " + show(customerOf(make())) + " | amount " + show(amountOf(make())) + " | paid " + show(paidOf(make())));
    console.log(phase + " | " + label + " | all three " + show(allThree(make())) + " | status " + show(statusOf(make())));
    console.log(phase + " | " + label + " | settled " + show(settle(make())) + " | json " + JSON.stringify(make()));
  }
  console.log(phase + " | total of all " + show(totalOf(makers.map(([, make]) => make()))));
  console.log(phase + " | total of the numbers " + show(totalOf(makers.filter(([label]) => !label.startsWith("Quote")).map(([, make]) => make()))));
}

look("at first");
for (const [trained, make] of makers) {
  let count = 0;
  for (let i = 0; i < 2000; i++) {
    const paper = make();
    if (customerOf(paper) && amountOf(paper) !== undefined && allThree(paper).length === 3 && statusOf(paper) && settle(paper).paid) count++;
  }
  console.log("2000 rounds with " + trained, count);
  look("after " + trained);
}
