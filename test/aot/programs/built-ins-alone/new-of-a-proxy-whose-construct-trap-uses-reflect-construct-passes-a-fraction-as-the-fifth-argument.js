class Target {
  constructor(first, second, third, fourth, fifth) {
    console.log(typeof fifth, fifth + 1);
  }
}
const handler = {
  construct(callee, passed) {
    return Reflect.construct(callee, passed);
  },
};
const made = new (new Proxy(Target, handler))(0, 1, 2, 3, 4.5);
