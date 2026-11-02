// `class Stamped extends Plain { stamp = 7 }` has the constructor that the language gives it. An instance that is kept is made as where the class says `constructor() { super(); }`.
// COUNT: arrivals = 0
// COUNT: branches <= 4600
// COUNT: operations <= 300
// COUNT: cells <= 2200
class Plain {
  id = 1;
}
class Given extends Plain {
  stamp = 7;
}
class Written extends Plain {
  stamp = 7;
  constructor() {
    super();
  }
}
const kept = new Array(8);
function makeGiven(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = new Given();
    kept[i & 7] = made;
    sum += made.id + made.stamp;
  }
  return sum;
}
function makeWritten(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = new Written();
    kept[i & 7] = made;
    sum += made.id + made.stamp;
  }
  return sum;
}
console.log(makeGiven(1000), makeWritten(1000));
