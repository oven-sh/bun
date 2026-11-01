// An assignment to a member of a function is not a definition: whatever is there first answers it.
function copyOwn(target, source) {
  for (const key of Reflect.ownKeys(source)) Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
}

function copied() {}
copied.label = "copied";
copyOwn(copied, {
  get shout() {
    return this.label.toUpperCase();
  },
  set shout(value) {
    this.label = value.toLowerCase();
  },
});
console.log(copied.shout);
copied.shout = "LOUD";
console.log(copied.label, Object.keys(copied));

function direct() {}
direct.label = "direct";
Object.defineProperty(direct, "shout", {
  set(value) {
    this.label = value;
  },
  configurable: true,
});
direct.shout = "through a setter";
console.log(direct.label, direct.shout, Object.keys(direct));

function inherits() {}
inherits.label = "inherits";
Object.setPrototypeOf(inherits, {
  set through(value) {
    this.label = value;
  },
});
inherits.through = "from above";
console.log(inherits.label, inherits.through, Object.keys(inherits));

function frozen() {}
frozen.before = 1;
Object.freeze(frozen);
try {
  frozen.before = 2;
} catch (error) {
  console.log(error.message);
}
try {
  frozen.after = 3;
} catch (error) {
  console.log(error.message);
}
console.log(frozen.before, frozen.after, Object.keys(frozen));

function readOnly() {}
Object.defineProperty(readOnly, "fixed", { value: "kept", writable: false });
try {
  readOnly.fixed = "lost";
} catch (error) {
  console.log(error.message);
}
console.log(readOnly.fixed);

function written() {}
written.label = "written";
function write(target, value) {
  target.label = value;
}
write(written, "by a helper");
console.log(written.label);
const name = ["label"][0];
written[name] = "by a key";
console.log(written.label);
