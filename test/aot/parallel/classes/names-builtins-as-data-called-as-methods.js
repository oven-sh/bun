// Names that built ins have as data are called as methods.
class Reply {
  constructor(code) {
    this.code = code;
    this.sent = 0;
  }
  method(i) {
    return this.code + (i & 1);
  }
  status(i) {
    this.code = i;
    return this;
  }
  type(i) {
    return "type " + (this.code + i);
  }
  url() {
    return "/" + this.code;
  }
  size() {
    return this.sent++;
  }
  signal(i) {
    return i > 2 ? undefined : this;
  }
}
class Heir extends Reply {
  method(i) {
    return super.method(i) * 2;
  }
}
function Old(code) {
  this.code = code;
}
Old.prototype.method = function (i) {
  return this.code - i;
};
Old.prototype.status = function (i) {
  this.code += i;
  return this;
};
const record = {
  code: 5,
  method(i) {
    return this.code * i;
  },
  status(i) {
    return { code: i, method: () => "inner " + i };
  },
};
const keepsAnything = { code: 1, method: undefined, status: 200, type: "text", url: "/", size: 3 };
const below = Object.create({
  method(i) {
    return this.code + i * 100;
  },
});
below.code = 1;
const shadowed = new Reply(9);
shadowed.method = function (i) {
  return -this.code - i;
};
const withGetter = {
  code: 2,
  get method() {
    this.code++;
    return i => this.code * 10 + i;
  },
};
const proxy = new Proxy(new Reply(30), {
  get(target, name, receiver) {
    return name === "method" ? i => "proxy " + i : Reflect.get(target, name, receiver);
  },
});

function callMethod(a, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a.method(i);
  return sum;
}
function callSeveral(a, n) {
  let text = "";
  for (let i = 0; i < n; i++) text += a.status(i).method(i) + " " + a.type(i) + a.url() + a.size() + (a.signal(i) === a) + ";";
  return text;
}
function readAndCall(a, n) {
  let text = "";
  for (let i = 0; i < n; i++) text += typeof a.method + (a.status === 200 ? " data " : " other ") + (typeof a.method === "function" ? a.method(i) : a.method) + ";";
  return text;
}
function callOnce(a) {
  return a.method(1);
}

const table = { callMethod, callSeveral, readAndCall, callOnce };
const hidden = ["call", "read"];
function tell(name, ...rest) {
  try {
    console.log(name, table[name](...rest));
  } catch (error) {
    console.log(name, error instanceof TypeError);
  }
}

const request = new Request("http://localhost/path", { method: "POST" });
const response = new Response("body", { status: 201 });
const receivers = [new Reply(3), new Heir(4), new Old(6), record, keepsAnything, below, shadowed, withGetter, proxy, request, response, new Blob(["ab"]), new Map(), "text", 4, null, undefined, {}, () => 1];
for (let round = 0; round < 3; round++) {
  for (const receiver of receivers) {
    tell(hidden[0] + "Method", receiver, 5);
    tell(hidden[1] + "AndCall", receiver, 3);
    tell(hidden[0] + "Once", receiver);
  }
  for (const receiver of [new Reply(1), new Heir(2), request, response, keepsAnything]) tell(hidden[0] + "Several", receiver, 4);
  if (round === 0)
    Reply.prototype.method = function (i) {
      return this.code * 1000 + i;
    };
  if (round === 1) {
    delete Reply.prototype.method;
    Object.defineProperty(Old.prototype, "method", { get: () => () => "from a getter" });
  }
}
let check = 0;
for (let i = 0; i < 20000; i++) {
  const receiver = i % 7 === 0 ? record : i % 5 === 0 ? below : i % 3 === 0 ? shadowed : new Heir(i & 3);
  try {
    check += table[hidden[0] + "Method"](receiver, 3);
  } catch (error) {
    check -= 1;
  }
}
console.log(check);
