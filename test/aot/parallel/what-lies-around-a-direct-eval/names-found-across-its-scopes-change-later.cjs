// Closures of evaluated text read and write names that no function around the eval binds, again and again, while globals come and go and later evals declare variables of those names.
const indirect = eval;
const log = [];
const note = (label, run) => {
  let answer = "";
  for (let i = 0; i < 4; i++) {
    try {
      answer += String(run(i)) + " ";
    } catch (error) {
      answer += error.name + " ";
    }
  }
  log.push(label + ": " + answer);
};
let step = 0;
const every = made => {
  step++;
  for (const name in made) note(`${step} ${name}`, made[name]);
};
const kept = [];
globalThis.shared = "global";
globalThis.shadow = "global shadow";
function closures(seen, texts) {
  let own = "own";
  let shadow = "local";
  const made = {
    shadow: eval("(function (i) { return shadow + typeof shadow + (shadow = 'stored' + i) })"),
    read: eval("(() => shared)"),
    kind: eval("(function () { return typeof shared })"),
    strict: eval('(function () { "use strict"; return typeof shared + own + seen })'),
    inner: eval("(function () { return (function () { return eval('typeof shared') + shared })() })"),
    own: eval("(function (i) { return own = typeof Math.max + i })"),
    write: eval("(function (value) { shared = value; return shared })"),
  };
  kept.push(made);
  every(made);
  for (const text of texts) {
    note(text, () => eval(text));
    every(made);
  }
}
closures(1, ["shared", "shared = 'assigned'", "typeof own"]);
delete globalThis.shared;
closures(2, ["typeof shared", "shared = 'made'"]);
delete globalThis.shared;
kept.forEach(every);
indirect("var shared = 'declared'");
kept.forEach(every);
// The variables that these declare hide the global from the closures of their own call alone.
closures(3, ["var shared = 'injected'; shared", "shared = 'into the variable'", "delete shared", "{ function shared() {} } typeof shared", "eval('var shared = 8; shared')", "with ({ shared: 9 }) { shared }"]);
kept.forEach(every);
closures(4, ["function shared() {} typeof shared", "let shared = 5; shared"]);
kept.forEach(every);
// Scopes of with and catch, and names that only they bind.
function around(object) {
  with (object) {
    try {
      throw "thrown";
    } catch (caught) {
      const read = eval("(() => [typeof bound, typeof caught, typeof unbound, typeof object, typeof Array])");
      const write = eval("(value => { bound = value; return bound })");
      note("around", read);
      note("write", write);
      note("around", read);
      delete object.bound;
      note("without", read);
      note("write", write);
      object.unbound = 1;
      note("with", read);
    }
  }
}
around({ bound: 1 });
delete globalThis.bound;
around({});
class Holder {
  #secret = 5;
  make() {
    return [eval("() => this.#secret + typeof shared"), eval("() => typeof unheardOf"), eval("value => { unheardOf = value }")];
  }
}
const [secret, unheard, assign] = new Holder().make();
note("class", secret);
note("class", unheard);
note("class", assign);
globalThis.unheardOf = 1;
note("class", unheard);
note("class", assign);
note("class", unheard);
console.log(log.join("\n"));
