// RUN: link
// CHECK: layout {{*}}kind=Instance name="F" {{*}}constructor=[[f]] fields=[{key="x" declared={type=number flags=[IsExpected]} flags=[IsRequired]}] flags=[IsConstructorFunction]
// CHECK: function [[f]] name="F"

// RUN(METHOD): link
// METHOD-NOT: layout {{*}}name="F"{{*}}key="m"

function F() {
  this.x = 1;
}

F.prototype.m = function () {};

export const instance = new F();
