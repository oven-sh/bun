const run = "~test/run";
const later = Symbol("later");

function makeProto(options) {
  return { kind: options.kind, [run]: options[run], [later]: options[later] };
}

const proto = makeProto({
  kind: "first",
  [run](value) {
    return this.kind + " " + value;
  },
  async [later](value) {
    return this.kind + " later " + value;
  },
});

function callIt(callee, self, value) {
  return callee.call(self, value);
}

function applyIt(callee, self, value) {
  return callee.apply(self, [value]);
}

function bindIt(callee, self, value) {
  return callee.bind(self)(value);
}

function plain(value) {
  return (this && this.kind) + " plain " + value;
}
const arrow = value => "arrow " + value;
const named = { ["computed" + 1]: function (value) { return this.kind + " function " + value; } }.computed1;

const self = { kind: "self" };
const lines = [];
for (let round = 0; round < 3; ++round) {
  for (const callee of [proto[run], plain, arrow, named]) lines.push(callIt(callee, self, round), applyIt(callee, self, round), bindIt(callee, self, round), callee.name, callee.length);
  lines.push(await callIt(proto[later], self, round), await applyIt(proto[later], self, round), proto[later].name);
}

const withOwnCall = makeProto({
  [run](value) {
    return "never " + value;
  },
})[run];
lines.push(callIt(withOwnCall, self, 1));
withOwnCall.call = (receiver, value) => "own call " + receiver.kind + " " + value;
withOwnCall.apply = (receiver, values) => "own apply " + receiver.kind + " " + values[0];
lines.push(callIt(withOwnCall, self, 2), applyIt(withOwnCall, self, 2), Object.keys(withOwnCall).join());

const withOtherPrototype = makeProto({
  [run](value) {
    return "unchanged " + value;
  },
})[run];
lines.push(callIt(withOtherPrototype, self, 1));
Object.setPrototypeOf(withOtherPrototype, { call: (receiver, value) => "inherited call " + value, apply: Function.prototype.apply });
lines.push(callIt(withOtherPrototype, self, 2), applyIt(withOtherPrototype, self, 2));

const withoutName = makeProto({
  [run](value) {
    return "no name " + value;
  },
})[run];
delete withoutName.name;
lines.push(callIt(withoutName, self, 1), withoutName.name === "", Object.getOwnPropertyNames(withoutName).join());

for (const notCallable of [{}, { call: 1 }, undefined, 3, class {}]) {
  try {
    lines.push(callIt(notCallable, self, 1));
  } catch (error) {
    lines.push(error instanceof TypeError);
  }
}
console.log(lines.join("\n"));
