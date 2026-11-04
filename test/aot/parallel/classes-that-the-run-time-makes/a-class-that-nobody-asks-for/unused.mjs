export class Unused {
  m() {
    return 1;
  }
}
class AlsoUnused extends Unused {}
console.log("the module with the unused classes has run");
