class Root {
  #secret = "root secret";
  shown = "root shown";
  get secret() {
    return this.#secret;
  }
  who() {
    return "Root.who";
  }
}
class Stranger {
  shown = "stranger shown";
  who() {
    return "Stranger.who";
  }
}
function Named(Base) {
  return class extends Base {
    name() {
      return "named";
    }
  };
}
function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}
function show(label, made) {
  console.log(label, attempt(() => made.secret), attempt(() => made.shown), attempt(() => made.who()), attempt(() => made.name?.()), made instanceof Root, made instanceof Stranger, Object.keys(made).join(","));
}
const classes = [];
for (let i = 0; i < 4; i++) classes.push(class extends (i & 1 ? Named(Root) : Root) {});
for (const each of classes) show("as defined", new each());
Object.setPrototypeOf(classes[0], Stranger);
show("constructor link changed", new classes[0]());
show("the others", new classes[2]());
Object.setPrototypeOf(classes[1].prototype, Stranger.prototype);
show("prototype link changed", new classes[1]());
show("the others", new classes[3]());
Object.setPrototypeOf(Object.getPrototypeOf(classes[3]).prototype, Stranger.prototype);
show("the link of the class between changed", new classes[3]());
Object.getPrototypeOf(classes[3]).prototype.who = function () {
  return "stored on the class between";
};
show("a member stored on the class between", new classes[3]());
Root.prototype.who = function () {
  return "stored on the root";
};
show("a member stored on the root", new classes[2]());
