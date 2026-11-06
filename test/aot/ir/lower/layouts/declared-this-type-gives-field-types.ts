// RUN: link
// CHECK: layout {{*}}kind=Instance name="Made" {{*}}fields=[{key="id" declared={type=number site=[[w0]]} flags=[IsRequired] {{*}}}, {key="text" declared={type=undefined|null|string site=[[w1]] flags=[OmitsNull, OmitsUndefined]} flags=[IsRequired] {{*}}}, {key="position" declared={type=undefined|number site=[[w2]]} flags=[IsRequired] {{*}}}, {key="extra" declared={type=number flags=[IsExpected]} flags=[IsRequired]}]

// What a constructor function stores into a `this` with a declared type has the type that is declared there, a number like anything else. A name that the type does not declare
// has the type of the first value stored, which is only expected.
interface Shape {
  id: number;
  text: string;
  position?: number;
}

function Made(this: Shape) {
  this.id = 0;
  this.text = "";
  this.position = undefined;
  (this as any).extra = 1;
}

export const made = new (Made as unknown as new () => Shape)();
