// The walked object is a class with a static field.
class Steps {
  static flatMap = n => [n, n];
}
let list = [1, 2, 3];
for (const step in Steps) list = list[step](Steps[step]);
console.log(list.length);
