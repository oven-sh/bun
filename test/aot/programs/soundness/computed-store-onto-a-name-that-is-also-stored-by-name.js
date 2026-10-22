// A store under a key that only the run knows reaches a name that flow made a field of the layout.
const names = JSON.parse('["late"]');
function record(i) {
  return { x: i, y: i + 1 };
}
const first = record(1);
first[names[0]] = 5;
const second = record(2);
second.late = "text";
console.log(first.late, second.late, Object.keys(first).join(), Object.keys(second).join());
