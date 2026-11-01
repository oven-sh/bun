// forEach() walks a list of numbers and an undefined, then find() stops at the undefined: how often its callback ran says where.
let out = "";
function note(value) {
  out += String(value) + ";";
}
function nothing() {}
function walk(list) {
  let text = "";
  list.forEach((each, at) => {
    text += "|" + at + ":" + each;
  });
  note(text);
  let met = 0;
  list.find(each => {
    met++;
    return each === undefined;
  });
  note(met);
}
walk([-1, 7, [][0]]);
walk(Array.from({ length: 3 }, (each, at) => (at === 1 ? nothing() : 1)));
console.log(out);
