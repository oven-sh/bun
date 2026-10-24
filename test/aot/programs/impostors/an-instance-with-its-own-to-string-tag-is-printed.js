class Range {
  from = 1;
}
const own = new Range();
own[Symbol.toStringTag] = "Tagged";
console.log(own, String(own));
