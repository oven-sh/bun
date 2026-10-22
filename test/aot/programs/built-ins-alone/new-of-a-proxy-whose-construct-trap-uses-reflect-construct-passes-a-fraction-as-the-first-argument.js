class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof first, first + 1);
  }
}
const handler = {
  construct(callee, passed) {
    return Reflect.construct(callee, passed);
  },
};
const made = new (new Proxy(Target, handler))(0.5, 1, 2, 3, 4);
