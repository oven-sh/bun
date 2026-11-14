// Prints where a stack trace places a call or a spread behind an expression in whose place Bun's transpiler prints its value.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-expressions-printed/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
function F() {}
show("holder[\"a\".length]();", () => { holder["a".length](); });
show("holder[[1, 2].length]();", () => { holder[[1, 2].length](); });
show("holder[[1][0]]();", () => { holder[[1][0]](); });
show("holder[[five][0]]();", () => { holder[[five][0]](); });
show("holder[{ a: 1 }.a]();", () => { holder[{ a: 1 }.a](); });
show("holder[{ a: 1 }[\"a\"]]();", () => { holder[{ a: 1 }["a"]](); });
show("holder[{ a: five }.a]();", () => { holder[{ a: five }.a](); });
show("holder[{ a: 1, b: 2 }.b]();", () => { holder[{ a: 1, b: 2 }.b](); });
show("holder[-Infinity]();", () => { holder[-Infinity](); });
show("holder[Infinity]();", () => { holder[Infinity](); });
show("holder[NaN]();", () => { holder[NaN](); });
show("holder[-NaN]();", () => { holder[-NaN](); });
show("holder[+Infinity]();", () => { holder[+Infinity](); });
show("holder[undefined]();", () => { holder[undefined](); });
show("holder[void 0]();", () => { holder[void 0](); });
show("holder[!0]();", () => { holder[!0](); });
show("holder[typeof 1]();", () => { holder[typeof 1](); });
show("holder[new Object]();", () => { holder[new Object](); });
show("holder[new Object()]();", () => { holder[new Object()](); });
show("holder[new Object({})]();", () => { holder[new Object({})](); });
show("holder[new Object(1)]();", () => { holder[new Object(1)](); });
show("holder[new Array()]();", () => { holder[new Array()](); });
show("holder[new Array(1)]();", () => { holder[new Array(1)](); });
show("holder[new Array(1, 2)]();", () => { holder[new Array(1, 2)](); });
show("holder[Array()]();", () => { holder[Array()](); });
show("holder[Array(1, 2)]();", () => { holder[Array(1, 2)](); });
show("holder[Object()]();", () => { holder[Object()](); });
show("holder[new Object().x]();", () => { holder[new Object().x](); });
show("[1][0]();", () => { [1][0](); });
show("[five][0]();", () => { [five][0](); });
show("[pass][0](nothing.x);", () => { [pass][0](nothing.x); });
show("({ a: 1 }).a();", () => { ({ a: 1 }).a(); });
show("\"a\".length();", () => { "a".length(); });
show("new Object()();", () => { new Object()(); });
show("new Object().x.y;", () => { new Object().x.y; });
show("new Array().x.y;", () => { new Array().x.y; });
show("[1][0].x.y;", () => { [1][0].x.y; });
show("\"a\".length.x.y;", () => { "a".length.x.y; });
show("holder[1 + 1]();", () => { holder[1 + 1](); });
show("holder[\"a\" + \"b\"]();", () => { holder["a" + "b"](); });
show("holder[`a`]();", () => { holder[`a`](); });
show("holder[`a${1}`]();", () => { holder[`a${1}`](); });
show("holder[1 ? 2 : 3]();", () => { holder[1 ? 2 : 3](); });
show("holder[five ? 2 : 3]();", () => { holder[five ? 2 : 3](); });
show("holder[1 && 2]();", () => { holder[1 && 2](); });
show("holder[0 || five]();", () => { holder[0 || five](); });
show("holder[null ?? 1]();", () => { holder[null ?? 1](); });
show("holder[(1, 2)]();", () => { holder[(1, 2)](); });
show("let once = pass(nothing); return [...z];", () => { let once = pass(nothing); return [...z]; });
show("return [...id(nothing)];", () => { return [...id(nothing)]; });
show("return [...n];", () => { return [...n]; });
show("return [1, ...n];", () => { return [1, ...n]; });
show("let once = nothing; return [...z];", () => { let once = nothing; return [...z]; });
show("let once = holder.a; return [...z];", () => { let once = holder.a; return [...z]; });
show("pass(...id(nothing));", () => { pass(...id(nothing)); });
show("let once = pass(nothing); new F(...z);", () => { let once = pass(nothing); new F(...z); });
