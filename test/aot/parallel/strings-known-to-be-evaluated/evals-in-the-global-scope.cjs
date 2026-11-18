// A direct eval in code that sees the global scope alone does not see the file either.
const say = (...a) => console.log(...a);
const attempt = f => { try { return f(); } catch (e) { return e.name + ": " + e.message; } };
const late = text => process.argv.length > 99 ? "" : text;
globalThis.asked = late("[typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname, typeof ofFile, typeof ofEval, typeof ofWith, typeof ofFunction, typeof arguments, this === globalThis].join()");
var ofFile = 1;
eval(late("var ofEval = 1"));
say(eval(asked));
say(new Function("return eval(asked)")());
say(Function("return (() => eval(asked))()")());
say(Function("return function () { return eval(asked); }")()());
say(Function("a = eval(asked)", "return a")());
say(Function("'use strict'; return eval(asked)")());
say((0, eval)("eval(asked)"));
say((0, eval)("'use strict'; eval(asked)"));
say((0, eval)("(() => eval(asked))()"));
say((0, eval)("(function () { return eval(asked); })()"));
say((0, eval)("{ let inner = 1; eval(asked + ' + inner'); }"));
function around() {
  var ofFunction = 1;
  with ({ ofWith: 1 }) return [eval(asked), new Function("return eval(asked)")(), (0, eval)("eval(asked)"), (0, eval)("(() => eval(asked))()")].join(" ");
}
say(around.call({}));
function declares() {
  eval(late("var ofFunction = 1"));
  return [eval(asked), new Function("return eval(asked)")(), (0, eval)("eval(asked)"), (0, eval)("(() => eval(asked))()")].join(" ");
}
say(declares.call({}));
class Secret {
  #hidden = 1;
  static ask(it) {
    globalThis.it = it;
    globalThis.askedOfClass = late("it.#hidden");
    return [attempt(() => eval(askedOfClass)), attempt(() => new Function("return eval(askedOfClass)")()), attempt(() => (0, eval)("eval(askedOfClass)")), attempt(() => (0, eval)("(() => eval(askedOfClass))()"))].join(" ");
  }
  up() {
    globalThis.askedOfMethod = late("typeof super.toString");
    return [attempt(() => eval(askedOfMethod)), attempt(() => new Function("return eval(askedOfMethod)")()), attempt(() => (0, eval)("eval(askedOfMethod)")), attempt(() => (0, eval)("(() => eval(askedOfMethod))()"))].join(" ");
  }
}
say(Secret.ask(new Secret()));
say(new Secret().up());
globalThis.declaration = late("var declared = 5; function made() { return 6; }");
new Function("eval(declaration)")();
say(typeof declared, typeof made, "declared" in globalThis);
(0, eval)("'use strict'; eval(declaration)");
say(typeof declared, typeof made, "declared" in globalThis);
(0, eval)("eval(declaration)");
say(typeof declared, typeof made, "declared" in globalThis, globalThis.declared);
globalThis.store = late("module = 1; ofFile = 2; ofEval = 3");
new Function("eval(store)")();
say(typeof module, ofFile, ofEval, globalThis.module, globalThis.ofFile, globalThis.ofEval);
globalThis.target = late("typeof new.target");
say(attempt(() => new Function("return eval(target)")()), attempt(() => (0, eval)("eval(target)")));
say(attempt(() => (0, eval)("(() => eval(target))()")), attempt(() => (0, eval)("(function () { return eval(target); })()")));
say(attempt(() => (0, eval)("'use strict'; (() => eval(target))()")), (0, eval)("'use strict'; (() => eval(asked))()"));
(0, eval)("(() => eval(store.replace(/\\d/g, '7')))()");
say(typeof module, ofFile, ofEval, globalThis.module, globalThis.ofFile, globalThis.ofEval);
globalThis.another = late("var another2 = 8; another2");
say((0, eval)("(() => eval(another))()"), typeof another2);
