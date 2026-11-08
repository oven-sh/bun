// Plain refuses a list of a million for want of stack and one over its bound on arguments: so does the call as written, which a long list goes to.
const say = (name, get) => { try { const value = get(); console.log(name, Object.is(value, -0) ? "-0" : String(value)); } catch (error) { console.log(name, error.constructor.name, String(error.message).split(" (")[0]); } };
for (const n of JSON.parse("[400000,600000,1000000,4000000]")) {
  const list = Array.from({ length: n }, (_, i) => (i * 7919) % 10007);
  say("max " + n, () => Math.max(...list));
  say("min " + n, () => Math.min(...list));
}
