import "reflect-metadata";

function logged(_target: object, _key: string): void {}
function sealed(_constructor: Function): void {}
class Address { city = "x"; }
@sealed
class Person {
  @logged name!: string;
  @logged age!: number;
  @logged address!: Address;
  constructor(public first: string, public count: number, public home: Address) {}
  @Reflect.metadata("role", "greeter") greet(@((_t: object, _k: string, _i: number) => {}) other: Person): string { return other.name; }
}
console.log(typeof Reflect.defineMetadata, typeof Reflect.getMetadata, Object.keys(Reflect).length);
console.log(["name", "age", "address"].map(key => (Reflect.getMetadata("design:type", Person.prototype, key) as Function).name).join());
console.log((Reflect.getMetadata("design:paramtypes", Person) as Function[]).map(type => type.name).join());
console.log(Reflect.getMetadata("role", Person.prototype, "greet"), (Reflect.getMetadata("design:returntype", Person.prototype, "greet") as Function).name);
Reflect.defineMetadata("k", { v: 1 }, Person);
console.log(JSON.stringify(Reflect.getMetadata("k", Person)), Reflect.getMetadataKeys(Person).join(), Reflect.hasOwnMetadata("k", Person.prototype));
console.log("DONE");
