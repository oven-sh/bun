// The object under `prototype` of a generator function gets a `next` of its own, behind loops that have stepped its generators and in front of more of them.
// Under: --aot-testing=CheckProofsAtRunTime: that the generators of count() stay as made (LinkedCoroutine::objectsStayAsMade, ObjectFact::IsPristine)
function* count(n) {
  for (let i = 0; i < n; i++) yield i;
}
function looped(n) {
  let text = "";
  for (const value of count(n)) text += String(value) + " ";
  return text;
}
function deed() {
  let turns = 0;
  count.prototype.next = function () {
    return { done: ++turns > 2, value: "own " + turns };
  };
}
console.log(looped(3));
for (let i = 0; i < 300; i++) {
  if (looped(2) !== "0 1 ") console.log("wrong at", i);
}
deed();
console.log(looped(3));
delete count.prototype.next;
console.log(looped(3));
