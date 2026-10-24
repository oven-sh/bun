class Model {
  id: number = 0;
  static made: number = 0;
  static create<T extends typeof Model>(this: T): InstanceType<T> { this.made++; return new this() as InstanceType<T>; }
  kind(): string { return "model"; }
}
class User extends Model {
  name: string = "user";
  kind(): string { return "user " + this.name; }
}
const u = User.create(), m = Model.create(), u2 = User.create();
console.log(u.kind(), m.kind(), u2.name, Model.made, User.made, Object.hasOwn(User, "made"), u instanceof User);
