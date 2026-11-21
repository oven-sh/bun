// An event's isTrusted comes first unless the target takes plain stores: then it is made the event's own, behind what was stored on it.
class Setter {
  set x(value) {}
}
class Plain {
  f = 1;
}
const classMadeAgain = () =>
  class {
    b = 1;
    m() {
      return 1;
    }
  };
const event = () => Object.assign(new Event("e"), { k: 1 });
const targets = {
  setter: () => new Setter(),
  plain: () => new Plain(),
  madeAgain: () => new (classMadeAgain())(),
  belowMadeAgain: () => Object.create(classMadeAgain().prototype),
};
for (let turn = 0; turn < 3; turn++) {
  for (const name in targets) console.log(name, Object.keys(Object.assign(targets[name](), event())).join());
}
