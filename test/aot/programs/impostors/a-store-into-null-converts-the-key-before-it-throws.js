const log = [];

const key = {
  toString() {
    log.push("key");
    return "a";
  },
};

function value() {
  log.push("value");
  return 1;
}

function report(label, run) {
  try {
    run();
    log.push("no error");
  } catch (error) {
    log.push(error.constructor.name);
  }
  console.log(label + ": " + log.splice(0).join(" "));
}

function store(target) {
  target[key] = value();
}

function storeAConstant(target) {
  target[key] = 1;
}

function read(target) {
  return target[key];
}

function add(target) {
  target[key] += value();
}

function remove(target) {
  delete target[key];
}

function call(target) {
  target[key](value());
}

for (const target of [null, undefined, {}]) {
  report("store into " + target, () => store(target));
  report("store a constant into " + target, () => storeAConstant(target));
  report("read from " + target, () => read(target));
  report("add to " + target, () => add(target));
  report("delete from " + target, () => remove(target));
  report("call on " + target, () => call(target));
}
