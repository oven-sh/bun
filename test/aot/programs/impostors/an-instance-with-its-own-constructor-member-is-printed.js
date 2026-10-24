class Range {
  from = 1;
}
class Backwards {}
const own = new Range();
own.constructor = Backwards;
console.log(own);
