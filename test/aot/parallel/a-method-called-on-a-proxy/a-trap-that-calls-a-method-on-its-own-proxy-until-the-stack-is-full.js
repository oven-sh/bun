// A get trap calls a method on its own Proxy: the stack fills, a RangeError is thrown and caught, and the Proxy answers again.
let depth = 0;
let deepest = 0;
let endless = true;
const proxy = new Proxy(
  { step: () => 1 },
  {
    get(target, name) {
      depth++;
      if (depth > deepest) deepest = depth;
      try {
        return endless ? (proxy.step(), target[name]) : target[name];
      } finally {
        depth--;
      }
    },
  },
);
function climb(holder) {
  try {
    return holder.step();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(climb(proxy), deepest > 100, depth);
endless = false;
console.log(climb(proxy), depth);
