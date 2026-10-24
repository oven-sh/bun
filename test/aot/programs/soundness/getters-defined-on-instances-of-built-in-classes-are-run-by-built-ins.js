// A getter that Object.defineProperty or __defineGetter__ puts on a promise or a regular expression, and nothing else is ever added to the object, is run by the built-ins that read the name.
const log = [];

const resolved = Promise.resolve("resolved");
Object.defineProperty(resolved, "constructor", {
  get() {
    log.push("constructor is read by resolve");
    return Promise;
  },
});
log.push(`resolve: ${Promise.resolve(resolved) === resolved}`);

const chained = new Promise(resolve => resolve("chained"));
Object.defineProperty(chained, "constructor", {
  get() {
    log.push("constructor is read by then");
    return Promise;
  },
});
log.push(`then: ${chained.then(value => value) !== chained}`);

const old = Promise.resolve("old");
old.__defineGetter__("constructor", function () {
  log.push("constructor is read after __defineGetter__");
  return Promise;
});
log.push(`__defineGetter__: ${Promise.resolve(old) === old}`);

const many = Promise.resolve("many");
Object.defineProperties(many, {
  constructor: {
    get() {
      log.push("constructor is read after defineProperties");
      return Promise;
    },
  },
});
log.push(`defineProperties: ${Promise.resolve(many) === many}`);

const reflected = Promise.resolve("reflected");
Reflect.defineProperty(reflected, "constructor", {
  get() {
    log.push("constructor is read after Reflect.defineProperty");
    return Promise;
  },
});
log.push(`Reflect.defineProperty: ${Promise.resolve(reflected) === reflected}`);

const pattern = /a/g;
Object.defineProperty(pattern, "flags", {
  get() {
    log.push("flags is read");
    return "g";
  },
});
log.push("banana".replaceAll(pattern, "o"));

const written = Promise.resolve("written");
Object.defineProperty(written, "constructor", {
  set(value) {
    log.push(`constructor is stored: ${value === Promise}`);
  },
});
written.constructor = Promise;
log.push(`setter alone: ${Promise.resolve(written) === written}`);

console.log(log.join("\n"));
