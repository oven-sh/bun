// A function of Node or Bun that refuses an argument names its constructor in the message: getters, proxy traps and a static `name` of the argument run.
function tell(name, call) {
  let message;
  try {
    message = "no error: " + call();
  } catch (error) {
    message = error.message;
  }
  console.log(name, "|", message);
}
function withGetter(call) {
  let count = 0;
  const box = { field: 1 };
  const operand = {
    get constructor() {
      count++;
      box.field = 2;
      return { name: "Named" };
    },
  };
  const before = count;
  let message = "no error";
  try {
    call(operand);
  } catch (error) {
    message = error.message;
  }
  return `${message} | ${before} ${count} ${box.field}`;
}
function allocWithGetter() {
  let count = 0;
  const box = { field: 1 };
  const operand = {
    get constructor() {
      count++;
      box.field = 2;
      return { name: "Named" };
    },
  };
  let message = "no error";
  try {
    Buffer.alloc(operand);
  } catch (error) {
    message = error.message;
  }
  return `${message} | ${count} ${box.field}`;
}
function allocWithProxy() {
  let count = 0;
  const operand = new Proxy(
    {},
    {
      get(target, key) {
        count++;
        return Reflect.get(target, key);
      },
    },
  );
  let message = "no error";
  try {
    Buffer.alloc(operand);
  } catch (error) {
    message = error.message;
  }
  return `${message} | ${count}`;
}
function allocWithStaticName() {
  let count = 0;
  class Thing {
    static get name() {
      count++;
      return "Renamed";
    }
  }
  let message = "no error";
  try {
    Buffer.alloc(new Thing());
  } catch (error) {
    message = error.message;
  }
  return `${message} | ${count}`;
}
function microtaskWithGetter() {
  let count = 0;
  const operand = {
    get constructor() {
      count++;
      return Array;
    },
  };
  let message = "no error";
  try {
    queueMicrotask(operand);
  } catch (error) {
    message = error.message;
  }
  return `${message} | ${count}`;
}
function compareWithInspect() {
  let count = 0;
  const operand = Object.create(null);
  operand[Symbol.for("nodejs.util.inspect.custom")] = () => {
    count++;
    return "custom";
  };
  let message = "no error";
  try {
    Buffer.compare(operand, operand);
  } catch (error) {
    message = error.message;
  }
  return `${message} | ${count}`;
}
console.log(allocWithGetter());
console.log(allocWithProxy());
console.log(allocWithStaticName());
console.log(microtaskWithGetter());
console.log(compareWithInspect());
for (const [name, call] of [
  ["allocUnsafe", v => Buffer.allocUnsafe(v)],
  ["byteLength", v => Buffer.byteLength(v)],
  ["concat", v => Buffer.concat(v)],
  ["from", v => Buffer.from(v)],
  ["write", v => Buffer.alloc(4).write(v)],
  ["readInt8", v => Buffer.alloc(4).readInt8(v)],
  ["fill", v => Buffer.alloc(4).fill(0, v)],
  ["copy", v => Buffer.alloc(4).copy(v)],
  ["join", v => require("node:path").join(v)],
  ["nextTick", v => process.nextTick(v)],
  ["on", v => new (require("node:events"))().on("x", v)],
  ["randomBytes", v => require("node:crypto").randomBytes(v)],
  ["gzipSync", v => require("node:zlib").gzipSync(v)],
  ["allocUnsafeBun", v => Bun.allocUnsafe(v)],
  ["fileURLToPath", v => Bun.fileURLToPath(v)],
])
  console.log(name, "|", withGetter(call));
