// A member is read by name through receivers of several shapes, and then replaced, redefined, deleted, shadowed or inherited from elsewhere: every later read sees the change.
function hide(value: any): any {
  try {
    throw value;
  } catch (caught) {
    return caught;
  }
}

class Replaced {
  visit() {
    return "declared";
  }
  other() {
    return "other";
  }
}
class BelowReplaced extends Replaced {}

class Redefined {
  count = 2;
  get visit() {
    return "getter " + this.count;
  }
  set visit(text: string) {
    this.count = text.length;
  }
  other() {
    return "other";
  }
}
class BelowRedefined extends Redefined {}

class Stored {
  count = 2;
  get visit() {
    return "getter " + this.count;
  }
  set visit(text: string) {
    this.count = text.length;
  }
  other() {
    return "other";
  }
}
class BelowStored extends Stored {}

class Deleted {
  visit() {
    return "declared";
  }
  other() {
    return "other";
  }
}
class BelowDeleted extends Deleted {}

class Shadowed {
  visit() {
    return "declared";
  }
  other() {
    return "other";
  }
}
class BelowShadowed extends Shadowed {}

class Moved {
  visit() {
    return "declared";
  }
  other() {
    return "other";
  }
}
class BelowMoved extends Moved {}

class Own {
  visit() {
    return "declared";
  }
  other() {
    return "other";
  }
}
class BelowOwn extends Own {}

function read(receivers: any[]) {
  let seen = "";
  for (let round = 0; round < 5; round++) {
    seen = receivers
      .map(each => {
        const found = each.visit;
        return typeof found === "function" ? found.call(each) : String(found);
      })
      .join(", ");
  }
  return seen;
}

const cases: [string, any, (parent: any, child: any, receivers: any[]) => void][] = [
  ["replaced", BelowReplaced, parent => void (parent.prototype.visit = () => "replaced")],
  [
    "redefined",
    BelowRedefined,
    parent => void Object.defineProperty(parent.prototype, "visit", { get: () => "redefined", configurable: true }),
  ],
  ["stored", BelowStored, (parent, child, receivers) => receivers.forEach(each => void (each.visit = "four"))],
  ["deleted", BelowDeleted, parent => void delete parent.prototype.visit],
  ["shadowed", BelowShadowed, (parent, child) => void (child.prototype.visit = () => "shadowed")],
  ["moved", BelowMoved, (parent, child) => void Object.setPrototypeOf(child.prototype, { visit: () => "moved" })],
  ["own", BelowOwn, (parent, child, receivers) => void (receivers[0].visit = () => "own")],
];

for (const [name, child, change] of cases) {
  const hidden = hide(child);
  const receivers = [
    new hidden(),
    Object.assign(new hidden(), { extra: 1 }),
    Object.create(hidden.prototype),
    Object.create(new hidden()),
  ];
  console.log(name, "before:", read(receivers));
  change(hide(Object.getPrototypeOf(child)), hidden, receivers);
  console.log(name, "after:", read(receivers));
  console.log(name, "constructor:", receivers.map(each => each.constructor === child).join(", "));
  console.log(name, "other:", receivers.map(each => typeof each.other).join(", "));
}
