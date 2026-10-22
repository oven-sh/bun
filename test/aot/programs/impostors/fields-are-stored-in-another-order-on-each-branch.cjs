function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function Message(order, from, to, body) {
  if (order === "from first") {
    this.from = from;
    this.to = to;
    this.body = body;
  } else if (order === "to first") {
    this.to = to;
    this.from = from;
    this.body = body;
  } else if (order === "body first") {
    this.body = body;
    this.to = to;
    this.from = from;
  } else if (order === "no body") {
    this.from = from;
    this.to = to;
  } else if (order === "twice") {
    this.from = "first store";
    this.to = to;
    this.from = from;
    this.body = body;
  } else if (order === "deleted in between") {
    this.from = from;
    this.to = to;
    delete this.from;
    this.body = body;
    this.from = from;
  } else if (order === "by computed names") {
    for (const [name, value] of [["body", body], ["from", from], ["to", to]]) this[name] = value;
  } else if (order === "by Object.assign") {
    Object.assign(this, { to, body, from });
  } else if (order === "by defineProperty") {
    Object.defineProperty(this, "body", { value: body, enumerable: true });
    this.from = from;
    Object.defineProperty(this, "to", { value: to, enumerable: false, writable: true });
  }
}
Message.prototype.route = function () {
  return this.from + " to " + this.to;
};

function routeOf(message) {
  return message.route();
}

function partsOf(message) {
  return [message.from, message.to, message.body];
}

function takeApart({ from, to, body = "no body" }) {
  return [from, to, body];
}

function walk(message) {
  const names = [];
  for (const name in message) names.push(name);
  return names;
}

const orders = ["from first", "to first", "body first", "no body", "twice", "deleted in between", "by computed names", "by Object.assign", "by defineProperty", "nothing at all"];

function look(phase) {
  for (const order of orders) {
    const message = new Message(order, "ann", "bob", "hello");
    console.log(phase + ", " + order + ": keys " + Object.keys(message).join());
    console.log(phase + ", " + order + ": for-in " + walk(message).join());
    console.log(phase + ", " + order + ": json " + JSON.stringify(message));
    console.log(phase + ", " + order + ": route " + show(routeOf(message)));
    console.log(phase + ", " + order + ": parts " + show(partsOf(message)));
    console.log(phase + ", " + order + ": destructured " + show(takeApart(message)));
    console.log(phase + ", " + order + ": spread " + show({ ...message }));
    message.body = "changed";
    console.log(phase + ", " + order + ": after a store to body " + show(message) + " " + show(message.body));
  }
}

look("at first");
let length = 0;
for (let i = 0; i < 2000; i++) {
  const message = new Message("from first", "a" + (i % 3), "b", "c");
  length += routeOf(message).length + partsOf(message).length + takeApart(message).length;
}
console.log("2000 messages of the first order", length);
look("later");
