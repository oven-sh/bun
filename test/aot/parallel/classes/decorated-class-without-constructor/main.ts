// Prints which decorated classes get `design:paramtypes` under `emitDecoratorMetadata` where fields are assigned: the class that writes a constructor, as in what TypeScript's compiler emits.
(Reflect as any).metadata = (about: string, value: unknown) => (target: any) => {
  console.log(target.name, about, JSON.stringify(value));
};
const mark: any = () => {};
@mark
class WithAField {
  field = 1;
}
@mark
class WithoutAField {}
@mark
class WithAStaticField {
  static field = 1;
}
@mark
class WithAConstructor {
  field = 1;
  constructor() {}
}
@mark
class WithParameters {
  field = 1;
  constructor(first: number, second: string) {}
}
@mark
class Below extends WithParameters {
  other = 2;
}
console.log(
  new WithAField().field,
  new WithoutAField() instanceof WithoutAField,
  WithAStaticField.field,
  new WithAConstructor().field,
  new Below(1, "a").other,
);
/* Output:
WithAConstructor design:paramtypes []
WithParameters design:paramtypes [null,null]
1 true 1 1 2
*/
