// RUN: link
// The prototype object of the function is hung below that of a class.
// CHECK: layout [[base]] kind=Instance name="Base"
// CHECK: layout {{*}}kind=Instance name="Below" {{*}} base=[[base]] {{*}}flags=[IsConstructorFunction]

export class Base {
  size = 1;
}

export function Below() {
  this.own = 2;
}
Object.setPrototypeOf(Below.prototype, Base.prototype);
