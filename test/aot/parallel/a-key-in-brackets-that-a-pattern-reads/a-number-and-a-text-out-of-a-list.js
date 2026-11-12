// So with a number, and with a text that the build works out of a written list.
const AT = 7;
const NAME = ["shelf"][0];
class Holder {
  [AT] = "seventh";
  [NAME] = "on the shelf";
}
const { [AT]: seventh, [NAME]: found } = new Holder();
console.log(seventh, found);
