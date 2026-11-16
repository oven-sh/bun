// Accessors that code defines under names that it does not spell, read and stored in loops.
const printed = [];
const print = (...values) => printed.push(values.map(String).join(" "));
const attempt = f => {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
};

function defineReactive(target, key, value) {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get() {
      return value;
    },
    set(next) {
      value = next;
    },
  });
}

const data = { count: 0, total: 1 };
for (const key of Object.keys(data)) defineReactive(data, key, data[key]);

class Model {
  constructor(values) {
    this._values = values;
    for (const key of Object.keys(values)) {
      Object.defineProperty(this, key, {
        configurable: true,
        get() {
          return this._values[key];
        },
        set(next) {
          this._values[key] = next;
        },
      });
    }
  }
}
const model = new Model({ width: 2, height: 3 });

class Response {
  constructor() {
    this.body = 1;
    this.status = 200;
  }
}
class Context {
  constructor() {
    this.response = new Response();
  }
}
for (const key of ["body", "status"]) {
  Object.defineProperty(Context.prototype, key, {
    configurable: true,
    get() {
      return this.response[key];
    },
    set(next) {
      this.response[key] = next;
    },
  });
}
const context = new Context();

function readData(times) {
  let sum = 0;
  for (let k = 0; k < times; k++) {
    attempt(() => {
      data.count = k & 7;
    });
    sum += data.count + data.total;
  }
  return sum;
}
function readModel(times) {
  let sum = 0;
  for (let k = 0; k < times; k++) {
    model.width = k & 7;
    sum += model.width * model.height;
  }
  return sum;
}
function readContext(times) {
  let sum = 0;
  for (let k = 0; k < times; k++) {
    context.body = k & 7;
    sum += context.body + context.status;
  }
  return sum;
}
print(readData(40), readModel(40), readContext(40));
print(Object.keys(data), JSON.stringify(data), Object.keys(model), JSON.stringify(model._values), JSON.stringify(context));

Object.defineProperty(data, "total", { get: () => 5, configurable: true });
print(readData(40), JSON.stringify(data));
Object.defineProperty(data, "count", { value: 9, writable: false, configurable: true });
print(readData(40), data.count);
delete data.count;
print(readData(40), data.count, Object.keys(data));
defineReactive(data, "count", "text");
print(readData(40), data.count);
Object.defineProperty(data, "count", { set: undefined });
print(readData(40), data.count);
Object.defineProperty(data, "count", { get: undefined });
print(readData(3), data.count);

Object.defineProperty(model, "width", { value: 4, writable: true });
print(readModel(40), model._values.width);
delete model.height;
print(readModel(4), Object.getOwnPropertyNames(model));
Object.defineProperty(Model.prototype, "height", { get: () => 10 });
print(readModel(40));

Object.defineProperty(Context.prototype, "status", { get: () => 1 });
print(readContext(40));
context.response = { body: "b", status: 2 };
print(readContext(4), context.body);
Object.defineProperty(context, "body", { get: () => 7, set() {} });
print(readContext(40));
Object.freeze(data);
print(readData(4));
console.log(printed.join("\n"));
