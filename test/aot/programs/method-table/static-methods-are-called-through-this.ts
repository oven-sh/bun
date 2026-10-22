// A static method calls another static method on this, so what it finds depends on the class it was called on. Subclasses override one or the other. Then a static method is replaced on the class in the middle, deleted again, and covered on the lowest class.
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

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

note("the base", Model.find(1));
note("the subclass", User.find(1));
note("below it", Admin.find(1));
note("another subclass", Guest.find(1));
note("through a parameter", findInAll());
User.table = () => 9;
note("replaced in the middle", findInAll());
note("below it", Admin.find(1));
Reflect.deleteProperty(User, "table");
note("deleted in the middle", findInAll());
Admin.table = () => 4;
note("covered on the lowest", findInAll());
Model.find = function (id: number) {
  return this.table() + id;
};
note("the caller is replaced", findInAll());

export {};
