// An iterator that has taken an entry of a Set or a Map made of constants stands behind that entry. The first write moves the entries; clear() then deletes them all,
// and what is added next lies in front of the iterator, the first of it too.
function show(label, ...values) {
  console.log(label, values.map(value => JSON.stringify(value)).join(" "));
}

{
  const set = new Set(["a", "b", "c"]);
  const iterator = set.values();
  show("set, first", iterator.next().value);
  set.add("d");
  set.clear();
  set.add("x");
  set.add("y");
  show("set, behind clear", iterator.next().value, iterator.next().value, iterator.next().done);
}

{
  const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const iterator = map.entries();
  show("map, first", iterator.next().value);
  map.set("d", 4);
  map.clear();
  map.set("x", 5);
  map.set("y", 6);
  show("map, behind clear", iterator.next().value, iterator.next().value, iterator.next().done);
}

{
  const set = new Set(["a", "b", "c"]);
  const iterator = set.keys();
  show("two taken", iterator.next().value, iterator.next().value);
  set.delete("a");
  set.clear();
  set.add("x");
  show("behind delete and clear", iterator.next().value, iterator.next().done);
}

{
  const map = new Map([["a", 1], ["b", 2]]);
  const iterator = map.keys();
  show("cleared at once", iterator.next().value);
  map.clear();
  map.set("x", 1);
  show("behind clear", iterator.next().value, iterator.next().done);
}

{
  const set = new Set(["a", "b", "c"]);
  const untouched = set.values();
  set.add("d");
  set.clear();
  set.add("x");
  show("nothing taken before", untouched.next().value, untouched.next().done);
}

{
  const set = new Set(["a", "b", "c"]);
  const seen = [];
  for (const value of set) {
    seen.push(value);
    if (value === "a") {
      set.add("d");
      set.clear();
      set.add("x");
      set.add("y");
    }
  }
  show("in a loop", seen);
}
