// new.target in functions and classes, abstract ones and calls without new
function Old(n) {
  if (!new.target) return new Old(n + 1);
  this.n = n;
}
class Abstract {
  constructor() {
    if (new.target === Abstract) throw new TypeError("abstract");
    this.kind = new.target.name;
  }
}
class Real extends Abstract {}
function run(n) {
  let failed;
  try {
    new Abstract();
  } catch (error) {
    failed = error.message;
  }
  return [new Old(n).n, Old(n).n, new Real().kind, failed, Reflect.construct(Abstract, [], Real).kind, Reflect.construct(Old, [n], Array).n].join();
}
console.log(run(1));
console.log(run(40));
console.log(run(-2));
