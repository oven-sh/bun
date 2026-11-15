// Static methods inherited, overridden, called by super and through this
class Model {
  static table = "models";
  static rows = [];
  static create(n) {
    const one = Object.assign(new this(), { n });
    this.rows.push(one);
    return one;
  }
  static describe() {
    return this.table + this.rows.length;
  }
}
class User extends Model {
  static table = "users";
  static rows = [];
  static create(n) {
    return super.create(n * 2);
  }
}
class Admin extends User {
  static describe() {
    return "admin " + super.describe();
  }
}
function run(n) {
  return [Model.create(n).n, User.create(n).n, Admin.create(n).n, Model.describe(), User.describe(), Admin.describe(), Admin.rows === User.rows].join();
}
console.log(run(1));
console.log(run(20));
console.log(run(0));
