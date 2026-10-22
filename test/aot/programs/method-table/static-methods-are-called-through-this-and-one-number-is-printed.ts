// A static method calls another static method on this, so what it finds depends on the class it was called on. Subclasses override one or the other. Then a static method is replaced on the class in the middle, deleted again, and covered on the lowest class. One number is printed.
class Model {
  static table(): number {
    return 1;
  }
  static find(id: number): number {
    return this.table() * 100 + id;
  }
}
class User extends Model {
  static table(): number {
    return 2;
  }
}
class Admin extends User {
  static find(id: number): number {
    return super.find(id) + 5000;
  }
}
class Guest extends Model {}

function findIn(model: typeof Model, id: number): number {
  return model.find(id);
}

function findInAll(): number {
  let sum = 0;
  for (const model of [Model, User, Admin, Guest]) sum += findIn(model, 7);
  return sum;
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

note(Model.find(1));
note(User.find(1));
note(Admin.find(1));
note(Guest.find(1));
note(findInAll());
User.table = () => 9;
note(findInAll());
note(Admin.find(1));
Reflect.deleteProperty(User, "table");
note(findInAll());
Admin.table = () => 4;
note(findInAll());
Model.find = function (id: number) {
  return this.table() + id;
};
note(findInAll());
console.log(checksum);

export {};
