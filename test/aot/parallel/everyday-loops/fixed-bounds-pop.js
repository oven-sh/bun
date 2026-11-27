// Pushes by a counter and pops between them
function undo(every, values) {
  const done = [];
  const gone = [];
  for (let i = 0; i < 6; i++) {
    done.push(values[i % values.length]);
    for (let k = 0; k < 2; k++) {
      if (i % every === k) gone.push(done.pop());
    }
    done.push(i);
  }
  return done.join() + " ; " + gone.join();
}
console.log(undo(2, [1, 2, 3]));
console.log(undo(3, ["p", null]));
console.log(undo(1, [0.5]), undo(5, [-0, 7, NaN]));
