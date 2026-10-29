// A call of a value that is no function throws a TypeError in the caller, whatever the value is, whether the callee has a name in the source, however many arguments are passed, and in tail position too, where the frame of the caller is still there when the error is made. Every kind of function is called the same ways and answers
// Flags: --aot-limit=MaxHotCodeValues:1
"use strict";
const lines = [];
function plain(a, b) { return "plain " + a + " " + b; }
class Class { static method(a) { return "static " + a; } }
const withProperty = a => "with a property " + a;
withProperty.extra = 1;
const callables = [plain, a => "arrow " + a, withProperty, plain.bind(null, "bound"), Math.abs, String, new Proxy(plain, {}), Class.method, function () { return "this is " + typeof this; }, async a => a, function* () {}];
const others = [undefined, null, 0, 1.5, NaN, "text", "", true, 10n, Symbol.iterator, {}, [], /x/, new Proxy({}, {}), Object.create(plain), Class.prototype];

function call0(callee) { const result = callee(); return [result]; }
function call1(callee, a) { const result = callee(a); return [result]; }
function call2(callee, a, b) { const result = callee(a, b); return [result]; }
function call9(callee, a) { const result = callee(a, a, a, a, a, a, a, a, a); return [result]; }
function callOn(callee, a) { const result = callee.call(a, a); return [result]; }
function callMember(holder, a) { const result = holder.member(a); return [result]; }
function callElement(list, a) { const result = list[0](a); return [result]; }
function callResult(make, a) { const result = make()(a); return [result]; }
function callSpread(callee, list) { const result = callee(...list); return [result]; }
function tail0(callee) { return callee(); }
function tail1(callee, a) { return callee(a); }
function tail2(callee, a, b) { return callee(a, b); }
function tail9(callee, a) { return callee(a, a, a, a, a, a, a, a, a); }
function tailMember(holder, a) { return holder.member(a); }
function tailElement(list, a) { return list[0](a); }
function tailResult(make, a) { return make()(a); }
function tailSpread(callee, list) { return callee(...list); }
function tailArguments(callee) { arguments[0] = -4; return callee.apply(undefined, arguments); }
const tailArrow = callee => callee();

const ways = {
  call0, call1: c => call1(c, -4), call2: c => call2(c, -4, 5), call9: c => call9(c, -4), callOn: c => callOn(c, -4),
  callMember: c => callMember({ member: c }, -4), callElement: c => callElement([c], -4), callResult: c => callResult(() => c, -4), callSpread: c => callSpread(c, [-4, 5]),
  tail0, tail1: c => tail1(c, -4), tail2: c => tail2(c, -4, 5), tail9: c => tail9(c, -4),
  tailMember: c => tailMember({ member: c }, -4), tailElement: c => tailElement([c], -4), tailResult: c => tailResult(() => c, -4), tailSpread: c => tailSpread(c, [-4, 5]),
  tailArguments, tailArrow,
};

function show(value) {
  if (Array.isArray(value)) return "[" + value.map(show).join() + "]";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value === "function" ? "function" : String(value);
}

for (const [name, way] of Object.entries(ways)) {
  callables.forEach((callee, number) => {
    try {
      lines.push(`${name} ${number}: ${show(way(callee))}`);
    } catch (error) {
      lines.push(`${name} ${number} throws ${error.constructor.name}`);
    }
  });
  others.forEach((callee, number) => {
    try {
      lines.push(`${name} other ${number}: ${show(way(callee))}`);
    } catch (error) {
      // The function that made the call is on the stack of the error.
      const frame = name.startsWith("call") || name.startsWith("tail") ? error.stack.split("\n").some(line => line.includes(name)) : false;
      lines.push(`${name} other ${number} throws ${error.constructor.name} ${error instanceof TypeError} ${frame}`);
    }
  });
}

// A class is a function and is not to be called.
for (const way of [call0, tail0, tailArrow]) {
  try {
    way(Class);
    lines.push("no error");
  } catch (error) {
    lines.push(error.constructor.name);
  }
}

// The arguments are evaluated before the callee is found wanting.
function argumentsFirst(callee) { return callee(lines.push("the argument was evaluated")); }
try {
  argumentsFirst(undefined);
} catch (error) {
  lines.push(error.constructor.name);
}

// A handler in the caller catches the error of its own call.
function catchesOwn(callee) {
  try {
    return callee(1);
  } catch (error) {
    return "caught " + error.constructor.name;
  } finally {
    lines.push("finally");
  }
}
lines.push(catchesOwn(undefined), catchesOwn({}), catchesOwn(a => a + 1));
console.log(lines.join("\n"));
