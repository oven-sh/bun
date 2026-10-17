// Anonymous functions and classes under computed keys are named after the key.
const k = "a" + 1;
class C { static [k] = function () {}; [k] = () => {}; static f = function () {}; g = () => {}; }
const o = { [k]: class {}, h: class {}, [k + 1]: function () {} };
console.log("written keys, and a function in a literal:", C.f.name, new C().g.name, o.h.name, o[k + 1].name);
console.log("computed keys:", C[k].name, "|", new C()[k].name, "|", o[k].name);
