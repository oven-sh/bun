/// <reference path="./shared.d.ts" />
class Crate {
  weight = 1;
}
enum Grade {
  Fine = 4,
}
function describe(grade: Grade): string {
  return grade + " " + Grade[grade];
}
console.log(new Crate().weight, new Crate().label, describe(Grade.Fine), describe(3));
