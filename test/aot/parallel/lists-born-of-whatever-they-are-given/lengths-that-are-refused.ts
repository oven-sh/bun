// A number that is no length is refused in the words of the constructor, and nothing else is: no conversion is asked of an object.
function make(x: any) { return new Array(x); }
function call(x: any) { return Array(x); }
function say(run: () => any[]) { try { const list = run(); return list.length + (0 in list ? "+" : "-"); } catch (error) { return (error as Error).constructor.name + ":" + (error as Error).message; } }
let asked = 0;
const proud = { valueOf() { asked++; return 2; }, toString() { asked++; return "2"; }, [Symbol.toPrimitive]() { asked++; return 2; } };
for (const f of [make, call])
  console.log([-1, -2147483648, 2147483647, 1.5, -0.5, NaN, Infinity, 4294967295, 4294967296, 99999, 100000, proud].map(x => say(() => f(x))).join(" "), asked);
