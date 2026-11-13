// Lists of names in constants that other functions of the file read, change, pass or hold.
const lines = [];
const say = (...all) => lines.push(all.join(" "));
function attempt(f) {
  try {
    const value = f();
    return typeof value === "function" ? "function" : String(value);
  } catch (error) {
    return error.constructor.name;
  }
}
const METHODS = ["get", "post", "put"];
class App {
  constructor() {
    this.routes = 0;
  }
  route(method, path) {
    this.routes += method.length + path.length;
    return this.routes;
  }
  list() {
    return METHODS.length;
  }
  has(name) {
    return METHODS.includes(name) && METHODS.indexOf(name) >= 0;
  }
}
METHODS.forEach(method => {
  App.prototype[method] = function (path) {
    return this.route(method, path);
  };
});
const LEVELS = ["debug", "info"];
class Logger {
  constructor() {
    this.count = 0;
    for (const level of LEVELS) this[level] = text => this.log(level, text);
  }
  log(level, text) {
    this.count += level.length + text.length;
    return this.count;
  }
  names() {
    return LEVELS.join();
  }
}
const PUSHED = ["first"];
function push() {
  PUSHED.push("pushed");
}
push();
const PASSED = ["second"];
function change(list) {
  list[0] = "passed";
}
change(PASSED);
const GIVEN = ["third"];
function give() {
  return GIVEN;
}
give()[0] = "given";
const THIRD = ["fourth", "fifth"];
THIRD.forEach((name, i, all) => {
  all[1] = "altered";
});
const COMPUTED = ["sixth"];
function call(method) {
  return COMPUTED[method]("computed");
}
call("push");
const HELD = ["seventh"];
const holder = { HELD };
holder.HELD[0] = "held";
class Target {
  constructor(v) {
    this.v = v;
  }
}
for (const list of [PUSHED, PASSED, GIVEN, THIRD, COMPUTED, HELD]) say(list.join());
PUSHED.forEach(name => { Target.prototype[name] = function (x) { return this.v + x; }; });
for (const name of PASSED) Target.prototype[name] = x => "passed" + x;
for (let i = 0; i < GIVEN.length; i++) Target.prototype[GIVEN[i]] = x => "given" + x;
THIRD.forEach(name => { Target.prototype[name] = () => name; });
for (const name of COMPUTED) Target.prototype[name] = () => name;
for (let i = 0; i < HELD.length; i++) {
  const name = HELD[i];
  Target.prototype[name] = () => name + i;
}
const app = new App(), logger = new Logger(), target = new Target(5);
function run(turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    sum ^= app.get("a") + app.put("bb") + app.post("c");
    sum ^= logger.info("a") + logger.debug("bb");
    sum ^= target.first(turn & 3) | 0;
  }
  return sum;
}
for (let round = 0; round < 3; round++) say(run(40), app.list(), app.has("post"), app.has("none"), logger.names());
for (const name of ["first", "pushed", "second", "passed", "third", "given", "fourth", "fifth", "altered", "sixth", "computed", "seventh", "held", "undefined", "get"]) {
  say(name, name in target, attempt(() => target[name]?.(2)));
}
say(attempt(() => target.pushed(1)), attempt(() => target.passed(1)), attempt(() => target.given(2)), attempt(() => target.altered()), attempt(() => target.computed()), attempt(() => target.held()), attempt(() => target.second(1)), attempt(() => target.fifth()));
say(Object.keys(Target.prototype).join(), Object.keys(App.prototype).join(), Object.keys(logger).join());
console.log(lines.join("\n"));
