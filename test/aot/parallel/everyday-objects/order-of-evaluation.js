// The order in which targets, keys and values are evaluated
function order(start) {
  const log = [];
  const note = (name, value) => (log.push(name), value);
  const list = [];
  let i = start;
  list[i++] = i;
  list[i] = i++ + i;
  note("object", list)[note("key", i)] = note("value", log.length);
  const object = { [note("a", "x")]: note("b", i), [note("c", "y")]: note("d", i + 1) };
  return list.join() + " " + log.join("") + " " + JSON.stringify(object);
}
console.log(order(0));
console.log(order(2));
console.log(order(1));
