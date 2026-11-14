// What built-ins make of the counter that has fallen below zero.
function find(list, wanted) {
  let i = list.length - 1;
  do {
    if (list[i] === wanted) break;
  } while (--i >= 0);
  return (
    JSON.stringify(i) +
    " " +
    new Date(i).getTime() +
    " " +
    (String(i) === "-1" ? "none" : "some")
  );
}
console.log(
  find(JSON.parse("[28,56,25]"), 30),
  find(JSON.parse("[28,56,25]"), 25),
);
