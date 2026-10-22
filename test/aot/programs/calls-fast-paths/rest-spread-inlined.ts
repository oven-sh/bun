// A rest parameter of an inlined function that is spread into another call needs no array, and the inner call is direct.
// IR- ^ .*NewArray
// IR- ^ .*(?: = Call(List|Spread) |overload=FunctionPrototypeApply/)
declare const console: any;
let n = 0;
function add(a: number, b: number) { n += a + b; }
function forward(...v: [number, number]) { add(...v); }
for (let i = 0; i < 5_000_000; i++) { forward(i & 1, 2); }
console.log(n);
export {};
