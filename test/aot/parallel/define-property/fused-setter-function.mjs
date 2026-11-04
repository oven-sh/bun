const tell = act => {
  try {
    return String(act());
  } catch (error) {
    return error.constructor.name;
  }
};
let seen = 0;
Object.defineProperties(Function.prototype, Object.getOwnPropertyDescriptors({ set extra(value) { seen = value; } }));
const P = new Proxy(function () {}, {});
console.log((Reflect.set(P, "extra", 41), String(seen)));
