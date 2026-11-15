// A list of over 65,535 elements goes to the call as written, which lays it on the stack. Plain refuses a list of millions for want of stack and one over its bound on arguments: so does that call.
// Where the stack ends hangs on the lane, and not alike for plain and compiled: under the address sanitizer plain answers up to 600,000 and compiled up to 500,000. The sizes lie clear of that on both sides.
const say = (name, get) => { try { const value = get(); console.log(name, Object.is(value, -0) ? "-0" : String(value)); } catch (error) { console.log(name, error.constructor.name, String(error.message).split(" (")[0]); } };
for (const n of JSON.parse("[70000,200000,2000000,4000000]")) {
  const list = Array.from({ length: n }, (_, i) => (i * 7919) % 10007);
  say("max " + n, () => Math.max(...list));
  say("min " + n, () => Math.min(...list));
}
