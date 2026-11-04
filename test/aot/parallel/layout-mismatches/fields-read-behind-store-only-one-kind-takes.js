// One function gets objects of two kinds: what `new Plain` makes, and what Plain makes for the new.target Watched, whose setter takes `value`. The store to `value` goes into a slot of a Plain alone, so behind it the other fields are read as those of a Plain.
// IR-UNTIL FinishBirths
// IRT= 1 update HasBirthFieldsFilled
// IRT= 3 update = GetSlot .* receivers=\[L0\]
const suffix = process.argv[2] ?? "";
const hide = new Function("value", "return value" + suffix);

function Plain(value) {
  this.value = value;
  this.version = 0;
  this.label = "plain";
}
class Watched {
  set value(next) {
    this.seen = next;
  }
}

function update(box, value) {
  box.value = value;
  box.version = box.version + 1;
  box.label = box.label + "!";
  return [box.value, box.version, box.label, Object.keys(box).join()];
}

const out = [];
for (let i = 0; i < 3; i++) out.push(update(hide(new Plain(i)), "v" + i));

const watched = hide(Reflect.construct(Plain, ["first"], Watched));
out.push(update(watched, "second"), watched.seen, watched instanceof Plain);

const shrunk = hide(new Plain(9));
delete shrunk.label;
out.push(update(shrunk, "shrunk"));
try {
  update(hide(Object.freeze(new Plain(8))), "frozen");
} catch (error) {
  out.push(error.constructor.name);
}
out.push(update(hide({ version: 1 }), "literal"));

console.log(JSON.stringify(out, (_, value) => (value === undefined ? "undefined" : value)));
