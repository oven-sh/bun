function make(list) {
  return new Set(list);
}

function joined(a, b) {
  return a + b;
}

function strings(count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push("s" + i);
  return list;
}

function say(name, list) {
  const set = make(list);
  const members = [...set].map(member => typeof member + ":" + String(member));
  console.log(name, set.size, members.join(","), set.has("s0"), set.has(undefined), set.has(1));
  set.add("added");
  set.delete("s1");
  console.log(name, "changed", set.size, [...set].length, list.length);
}

for (const count of [3, 8, 9, 12]) {
  const trailing = strings(count);
  trailing[count + 1] = "after-hole";
  say("hole past end " + count, trailing);

  const inner = strings(count);
  delete inner[1];
  say("hole inside " + count, inner);

  const long = "a text long enough that joining it stays a rope until the characters are read";
  const ropes = strings(count);
  ropes[count - 1] = joined(long, "1");
  ropes[0] = joined(long, "1");
  say("rope " + count, ropes);

  const numbers = strings(count);
  numbers[count - 1] = 1;
  numbers[0] = "1";
  say("number " + count, numbers);

  const named = strings(count);
  named.foo = "own property";
  say("own property " + count, named);

  const otherPrototype = strings(count);
  Object.setPrototypeOf(otherPrototype, Object.create(Array.prototype));
  say("prototype between " + count, otherPrototype);

  const iterablePrototype = strings(count);
  Object.setPrototypeOf(iterablePrototype, {
    *[Symbol.iterator]() {
      yield "from prototype";
      yield this.length;
    },
  });
  say("iterator on prototype " + count, iterablePrototype);

  const ownIterator = strings(count);
  ownIterator[Symbol.iterator] = function* () {
    yield "own iterator";
  };
  say("own iterator " + count, ownIterator);

  class Reversed extends Array {
    *[Symbol.iterator]() {
      for (let i = this.length - 1; i >= 0; i--) yield this[i];
    }
  }
  const reversed = new Reversed();
  for (const text of strings(count)) reversed.push(text);
  say("subclass with iterator " + count, reversed);

  class Plain extends Array {}
  const plain = new Plain();
  for (const text of strings(count)) plain.push(text);
  say("subclass " + count, plain);
}

for (const count of [1, 5, 8, 9, 12, 300]) {
  const list = strings(count);
  for (const text of strings(count)) list.push(text);
  say("duplicates " + count, list);
  console.log("list unchanged", list.length, list[0]);
}
console.log(make([]).size);
