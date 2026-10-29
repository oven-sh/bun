// Code of the program runs inside an operation and throws: a primitive, or an object of the program. The catch clause around the operation gets that value and no error of the run time.
class Body {
  constructor(mass) {
    this.mass = mass;
  }
  weight() {
    return this.mass * 2;
  }
}
const world = [new Body(1), new Body(2), new Body(3)];
const seen = [];
function note(caught) {
  seen.push(typeof caught === "object" && caught !== null ? caught.weight() : String(caught));
  if (typeof caught === "object" && caught !== null) caught.mass += 10;
}

const withGetter = {
  get mass() {
    throw world[0];
  },
};
const withSetter = {
  set mass(value) {
    throw value;
  },
};
const withValueOf = {
  valueOf() {
    throw world[1];
  },
};
const withToString = {
  toString() {
    throw "text";
  },
};
const withIterator = {
  [Symbol.iterator]() {
    throw world[2];
  },
};
class Below extends Body {
  get label() {
    throw 7;
  }
}

try {
  withGetter.mass;
} catch (caught) {
  note(caught);
}
try {
  withSetter.mass = world[1];
} catch (caught) {
  note(caught);
}
try {
  withValueOf + 1;
} catch (caught) {
  note(caught);
}
try {
  world[withToString];
} catch (caught) {
  note(caught);
}
try {
  for (const each of withIterator) seen.push(each);
} catch (caught) {
  note(caught);
}
try {
  new Below(4).label;
} catch (caught) {
  note(caught);
}
try {
  Object.create(withGetter).mass;
} catch (caught) {
  note(caught);
}
try {
  throw null;
} catch (caught) {
  note(caught);
}
try {
  await {
    then() {
      throw world[2];
    },
  };
} catch (caught) {
  note(caught);
}
try {
  await {
    get then() {
      throw undefined;
    },
  };
} catch (caught) {
  note(caught);
}
seen.push(world.map(body => body.mass).join("+"));
console.log(seen.join(" "));
