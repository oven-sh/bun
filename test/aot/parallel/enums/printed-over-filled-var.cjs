const show = (name, value) => console.log(name + ":", typeof value, JSON.stringify(value));
function besideDefault(E = { Z: "z" }) { var E; (function (E) { E["A"] = "a"; })(E || (E = {})); return E; }
show("a var beside a parameter with a default", besideDefault());
function besideDefaultAsEsbuildPrints(E = { Z: "z" }) { var E = (E => { E["A"] = "a"; return E; })(E || {}); return E; }
show("the same as esbuild prints it", besideDefaultAsEsbuildPrints());
function besideParameter(E) { var E; (function (E) { E["A"] = "a"; })(E || (E = {})); return E; }
show("a var beside a plain parameter", besideParameter({ Z: "z" }));
function forIn() { for (var E in { k: 1 }) {} (function (E) { E["A"] = "a"; })(E || (E = {})); return E; }
show("the head of for-in", forIn());
function forOf() { for (var E of [{ Z: "z" }]) {} (function (E) { E["A"] = "a"; })(E || (E = {})); return E; }
show("the head of for-of", forOf());
function forInOverName() { var E; for (E in { k: 1 }) {} (function (E) { E["A"] = "a"; })(E || (E = {})); return E; }
show("for-in over the name", forInOverName());
function pattern() { var { E } = { E: { Z: "z" } }; var E; (function (E) { E["A"] = "a"; })(E || (E = {})); return E; }
show("a pattern", pattern());
function caught() { try { throw { Z: "z" }; } catch (E) { var E; (function (E) { E["A"] = "a"; })(E || (E = {})); return E; } }
show("in a catch of the name", caught());
function declared() { var E; (function (E) { E["A"] = "a"; })(E || (E = {})); return E; function E() {} }
show("a function of the name", declared());
function hoistedWriter() { fill(); var E; (function (E) { E["A"] = "a"; })(E || (E = {})); return E; function fill() { E = { Z: "z" }; } }
show("a hoisted function stores", hoistedWriter());
function inLoop() { let first; for (let i = 0; i < 2; i++) { var E; (function (E) { E["A"] = "a"; })(E || (E = {})); if (i) return first === E; first = E; } }
show("in a loop", inLoop());
function empty() { var E; (function (E) { E["A"] = "a"; })(E || (E = {})); return E; }
show("nothing fills it", empty());
