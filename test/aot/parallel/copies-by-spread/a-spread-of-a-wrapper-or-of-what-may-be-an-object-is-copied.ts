// What only may be a primitive is still asked: an object behind `any`, a wrapper with a property laid on it, a function with a property, a list. And a rest pattern off a number makes an empty object.
function copy(a: number, more: any) { const o: any = { a, ...more }; return o; }
function rest(value: any) { const { toFixed, ...others } = value; return typeof toFixed + " " + JSON.stringify(others); }
function show(o: any) { return JSON.stringify(o) + " " + Object.keys(o).join(); }
const wrapper: any = new Number(5); wrapper.held = 1;
const callable: any = function () {}; callable.tag = "t";
const sources: any[] = [undefined, 1, wrapper, null, callable, true, [7, 8], 3n, { get late() { return "got"; } }, Symbol.for("s")];
for (let i = 0; i < sources.length; i++) console.log(i, show(copy(i, sources[i])));
console.log(rest(1.5), rest(wrapper));
