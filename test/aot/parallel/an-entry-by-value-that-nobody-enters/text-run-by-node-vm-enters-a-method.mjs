// Text that node:vm and new Function run enters a method whose every call in the program is copied.
import vm from "node:vm";
class Box {
  constructor(n) {
    this.n = n;
  }
  twice() {
    return this.n * 2;
  }
}
const box = new Box(2);
console.log(box.twice());
globalThis.kept = box;
console.log(vm.runInThisContext("kept.twice()"), vm.runInNewContext("b.twice()", { b: box }), new Function("b", "return b.twice()")(box));
