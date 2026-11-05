// RUN: link
// CHECK: layout {{*}}kind=Instance name="Made" {{*}}fields=[{key=symbol("kCount"){{*}} declared={type=number site=[[w0]]} flags=[IsRequired] {{*}}}, {key=symbol("kOwner"){{*}} declared={type=undefined|null|string site=[[w1]]

// `this[kCount] = 0` in a constructor function whose `this` has a declared type: a field under a symbol has the type that is declared there, as a field under a name has.
// It is not "a name that is only stored", which has the type of the first value stored: `null` for kOwner.
const kCount = Symbol("kCount");
const kOwner = Symbol("kOwner");

interface Shape {
  [kCount]: number;
  [kOwner]: string | null;
}

function Made(this: Shape) {
  this[kCount] = 0;
  this[kOwner] = null;
}

export const made = new (Made as unknown as new () => Shape)();
