// Prints which frames stand between a constructor that throws and the function that reached it through Reflect.construct.
Error.prepareStackTrace = (error, sites) =>
  sites.map(site => (site.isConstructor() ? "new " : "") + (site.getFunctionName() ?? "-") + (site.isNative() ? " [native]" : ""));
function show(label, call) {
  try {
    call();
    console.log(label, "| did not throw");
  } catch (error) {
    const frames = error.stack;
    console.log(label, "|", error.constructor.name, "|", frames.slice(0, frames.indexOf("show")).join(" < "));
  }
}
function F() { throw new Error("F"); }
class C { constructor() { throw new Error("C"); } }
function id(x) { return x; }
const R = Reflect, held = Reflect.construct, o = { Reflect, construct: Reflect.construct };
show("written", function () { Reflect.construct(F, []); });
show("written, three arguments", function () { Reflect.construct(F, [], Object); });
show("written, four arguments", function () { Reflect.construct(F, [], Object, 1); });
show("written, a class", function () { Reflect.construct(C, []); });
show("written, one argument", function () { Reflect.construct(F); });
show("written, no argument", function () { Reflect.construct(); });
show("written, optional call", function () { Reflect.construct?.(F, []); });
show("written, optional member", function () { Reflect?.construct(F, []); });
show("written, brackets", function () { Reflect["construct"](F, []); });
show("written, parentheses", function () { (Reflect.construct)(F, []); });
show("spread of everything", function () { Reflect.construct(...[F, []]); });
show("spread of the second", function () { Reflect.construct(F, ...[[]]); });
show("spread of the third", function () { Reflect.construct(F, [], ...[Object]); });
show("held in a constant", function () { held(F, []); });
show("held in a local", function () { const c = Reflect.construct; c(F, []); });
show("behind a comma", function () { (0, Reflect.construct)(F, []); });
show("another name of Reflect", function () { R.construct(F, []); });
show("globalThis.Reflect", function () { globalThis.Reflect.construct(F, []); });
show("Reflect as a member", function () { o.Reflect.construct(F, []); });
show("construct as a member", function () { o.construct(F, []); });
show("call", function () { Reflect.construct.call(null, F, []); });
show("apply", function () { Reflect.construct.apply(null, [F, []]); });
show("Reflect.apply", function () { Reflect.apply(Reflect.construct, null, [F, []]); });
show("bound", function () { Reflect.construct.bind(null)(F, []); });
show("a parameter named Reflect", function () { (function (Reflect) { Reflect.construct(F, []); })(R); });
show("Reflect through a function", function () { id(Reflect).construct(F, []); });
show("no constructor", function () { Reflect.construct(() => {}, []); });
show("no list", function () { Reflect.construct(F, 1); });
show("new target is no constructor", function () { Reflect.construct(F, [], () => {}); });
show("bound target", function () { Reflect.construct(F.bind(null), []); });
show("host target", function () { Reflect.construct(URL, ["::"]); });
show("new target is a function", function () { Reflect.construct(F, [], function N() {}); });
show("new target is a class", function () { Reflect.construct(C, [], class N {}); });
show("in an arrow", () => { Reflect.construct(F, []); });
show("in a constructor", function () { class K { constructor() { return Reflect.construct(F, [], new.target); } } new K(); });
show("in tail position", function () { "use strict"; return Reflect.construct(F, []); });
show("held, in tail position", function () { "use strict"; return held(F, []); });
/* Output:
written | Error | new F < 
written, three arguments | Error | new F < 
written, four arguments | Error | new F < 
written, a class | Error | new C < 
written, one argument | TypeError | construct [native] < 
written, no argument | TypeError | construct [native] < 
written, optional call | Error | new F < 
written, optional member | Error | new F < 
written, brackets | Error | new F < 
written, parentheses | Error | new F < 
spread of everything | Error | new F < construct [native] < 
spread of the second | Error | new F < construct [native] < 
spread of the third | Error | new F < construct [native] < 
held in a constant | Error | new F < construct [native] < 
held in a local | Error | new F < construct [native] < 
behind a comma | Error | new F < construct [native] < 
another name of Reflect | Error | new F < construct [native] < 
globalThis.Reflect | Error | new F < construct [native] < 
Reflect as a member | Error | new F < construct [native] < 
construct as a member | Error | new F < construct [native] < 
call | Error | new F < construct [native] < 
apply | Error | new F < construct [native] < 
Reflect.apply | Error | new F < construct [native] < 
bound | Error | new F < construct [native] < 
a parameter named Reflect | Error | new F <  < 
Reflect through a function | Error | new F < construct [native] < 
no constructor | TypeError | construct [native] < 
no list | TypeError | construct [native] < 
new target is no constructor | TypeError | construct [native] < 
bound target | Error | new F < 
host target | TypeError | URL [native] < 
new target is a function | Error | new F < 
new target is a class | Error | new C < 
in an arrow | Error | new F < 
in a constructor | Error | new F < new K < 
in tail position | Error | new F < 
held, in tail position | Error | new F < construct [native]
*/
