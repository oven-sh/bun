// Slice by argument count on unknown receivers.
function copy(list) {
  return list.slice();
}
function from(list, start) {
  return list.slice(start);
}
function between(list, start, end) {
  return list.slice(start, end);
}

function show(name, value) {
  console.log(name, Array.isArray(value), typeof value === "string" ? value : JSON.stringify(value), value.length);
}

class Stack extends Array {
  top() {
    return this[this.length - 1];
  }
}

var withSpecies = [1, 2, 3];
withSpecies.constructor = {
  [Symbol.species]: function (length) {
    return { made: length };
  },
};

var receivers = {
  empty: [],
  integers: [1, 2, 3],
  doubles: [1.5, 2.5],
  mixed: ["a", {}, null, undefined],
  holes: [1, , 3],
  text: "text",
  named: Object.assign([1, 2], { label: "x" }),
  frozen: Object.freeze([4, 5]),
};

for (var name in receivers) {
  var receiver = receivers[name];
  var all = copy(receiver);
  show(name, all);
  show(name + " from 1", from(receiver, 1));
  show(name + " from -1", from(receiver, -1));
  show(name + " 0 to 1", between(receiver, 0, 1));
  show(name + " undefined", from(receiver, undefined));
  if (typeof receiver !== "string") {
    console.log(all !== receiver, 1 in all === 1 in receiver, Object.isFrozen(all), all.label);
    all.push(9);
    console.log(all.length - receiver.length);
  }
}

var stack = Stack.from([1, 2, 3]);
var copied = copy(stack);
console.log(copied instanceof Stack, copied.top(), copied.length);
console.log(JSON.stringify(copy(withSpecies)));
console.log(JSON.stringify(copy({ slice: function () { return [arguments.length]; } })));
console.log(new Uint8Array([1, 2, 3]).slice().length, copy(new Uint8Array([7, 8]))[1]);

var listeners = [function () { return 1; }, function () { return 2; }];
var total = 0;
for (var i = 0; i < 1000; i++) {
  var snapshot = copy(listeners);
  if (i === 500) listeners.push(function () { return 3; });
  for (var j = 0; j < snapshot.length; j++) total += snapshot[j]();
}
console.log(total);

try {
  copy(null);
} catch (error) {
  console.log(error instanceof TypeError);
}
