function watch(target, log, answers) {
  return new Proxy(target, {
    has(target, key) {
      log.push(`has ${String(key)}`);
      return answers.length ? answers.shift() : Reflect.has(target, key);
    },
    get(target, key, receiver) {
      log.push(`get ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push(`set ${String(key)}`);
      return Reflect.set(target, key, value, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      log.push(`describe ${String(key)}`);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    defineProperty(target, key, descriptor) {
      log.push(`define ${String(key)}`);
      return Reflect.defineProperty(target, key, descriptor);
    },
  });
}
function attempt(label, answers, makeRun) {
  const log = [];
  const target = { count: 1 };
  let outcome = "stored";
  try {
    makeRun(watch(target, log, answers))();
  } catch (error) {
    outcome = error.name;
  }
  console.log(`${label}: ${outcome}, ${target.count}: ${log.join(", ")}`);
}
attempt("strict, the name stays", [], shelf => {
  with (shelf) return class { static run() { count = 2; } }.run;
});
attempt("strict, the second answer is no", [true, false], shelf => {
  with (shelf) return class { static run() { count = 2; } }.run;
});
attempt("sloppy, the second answer is no", [true, false], shelf => {
  with (shelf) return function () { count = 2; };
});
attempt("strict, read and store", [true, false], shelf => {
  with (shelf) return class { static run() { count += 2; } }.run;
});
