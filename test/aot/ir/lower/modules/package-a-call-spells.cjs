// A method loads what it is passed, and a call under the name of the method spells a package. The file of that package stands in the program, and that of no other.
// RUN: link
// CHECK: path="{{*}}/node_modules/spelled-driver/index.js"
// CHECK-NOT: path="{{*}}/node_modules/values-package/

class Manager {
  load(name) {
    return require(name);
  }
}
class Special extends Manager {
  constructor() {
    super();
    this.driver = this.load("spelled-driver");
    this.other = this.find("values-package");
  }
  find(name) {
    return name;
  }
}
module.exports = () => new Special().driver.which;
