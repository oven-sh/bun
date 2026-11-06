// Lexical declaration in a case: compiled answers as plain.
function s(x) {
  switch (x) {
    case 1:
      let v = "one";
      return v;
    case 2:
      try {
        return v;
      } catch (e) {
        return e.constructor.name;
      }
  }
}
console.log(s(1), s(2));
