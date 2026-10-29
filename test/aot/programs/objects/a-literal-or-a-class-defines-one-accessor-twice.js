// Object literals and classes define one getter or one setter twice, with other members between: the order of the own keys. Plain Bun prints another output.
function show(label, made) {
  console.log(label, Reflect.ownKeys(made).join());
}
show("setter, method, setter", { set d(value) {}, between() {}, set d(value) {} });
show("getter, method, getter", {
  get d() {
    return 1;
  },
  between() {},
  get d() {
    return 2;
  },
});
show("setter, value, setter", { set d(value) {}, between: 1, set d(value) {} });
show("getter, setter, method, getter", {
  get d() {
    return 1;
  },
  set d(value) {},
  between() {},
  get d() {
    return 2;
  },
});
show("setter three times", { set d(value) {}, first: 1, set d(value) {}, second: 2, set d(value) {} });
show("two names", {
  set d(value) {},
  get e() {
    return 1;
  },
  between: 1,
  get e() {
    return 2;
  },
  set d(value) {},
});
show("getter, method, setter", {
  get d() {
    return 1;
  },
  between() {},
  set d(value) {},
});
show("value, method, getter", {
  d: 1,
  between() {},
  get d() {
    return 2;
  },
});
show("getter, method, value", {
  get d() {
    return 1;
  },
  between() {},
  d: 2,
});
show("setter, computed key, setter", { set d(value) {}, ["between"]: 1, set d(value) {} });
show("setter, spread, setter", { set d(value) {}, ...{ between: 1 }, set d(value) {} });
const read = {
  get d() {
    return "first";
  },
  between: 1,
  set d(value) {},
  get d() {
    return "last";
  },
};
console.log(read.d, Object.keys(read).join(), JSON.stringify(read));
class Twice {
  set d(value) {}
  between() {}
  set d(value) {}
  static get s() {
    return 1;
  }
  static between() {}
  static get s() {
    return 2;
  }
}
show("class", Twice.prototype);
show("static", Twice);
