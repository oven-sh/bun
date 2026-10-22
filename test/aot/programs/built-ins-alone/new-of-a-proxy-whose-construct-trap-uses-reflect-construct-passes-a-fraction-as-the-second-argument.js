class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof second, second + 1);
  }
}
const handler = {
  construct(callee, passed) {
    return Reflect.construct(callee, passed);
  },
};
const made = new (new Proxy(Target, handler))(0, 1.5, 2, 3, 4);
