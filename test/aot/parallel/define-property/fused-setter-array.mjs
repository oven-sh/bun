const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
let seen = 0;
Object.defineProperties(Array.prototype, Object.getOwnPropertyDescriptors({ set extra(value) { seen = value; } }));
const P = new Proxy([1, 2], {});
console.log((Reflect.set(P, "extra", 41), String(seen)));
