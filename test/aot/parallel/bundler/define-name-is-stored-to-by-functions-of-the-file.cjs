// Functions store through defined names whose `--define` values are one name each to the `let` and to the `var` of the file that have those names, and a `while` loop of the file counts through a third: the file reads what was stored.
// Flags: --define KEPT=kept --define COUNT=count --define TURNS=turns
let kept = "the initializer";
var count = 0;
const store = value => {
  KEPT = value;
};
function bump() {
  COUNT++;
}
store("stored by the arrow function");
bump();
bump();
let turns = 0;
while (turns < 3) TURNS++;
console.log(kept, count, turns);
