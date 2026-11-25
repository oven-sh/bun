// RUN: link
// CHECK: layout {{*}}kind=Instance name="Made" {{*}}fields=[{key="id" declared={type=number} flags=[IsRequired] {{*}}}, {key="text" declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} flags=[IsRequired] {{*}}}, {key="position" declared={type=undefined|number} flags=[IsRequired] {{*}}}, {key="extra" declared={type=anything} flags=[IsRequired]}]

// What a constructor function stores into a `this` with a declared type has the type that is declared there, a number like anything else. A name that the type does not declare
// is untyped: the engine follows what is stored there.
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
