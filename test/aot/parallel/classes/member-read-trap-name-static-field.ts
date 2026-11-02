// Nothing reads the static field `size`. The trap reads a member of the same name off another object, under a key that is known only once the trap has been inlined into the read.
// Flags: --aot-heat=everything-is-hot
const told: string[] = [];
function tell<V>(name: string, value: V): V {
  told.push(name);
  return value;
}
class Teller {
  constructor(name: string) {
    tell(name, 0);
  }
}

const throughATrap = {
  value: new Proxy({ size: 1 }, {
    get(target, key) {
      tell("the trap", 0);
      return Reflect.get(target, key);
    },
  }).size,
};
const replaced = { value: "a".replace("a", () => tell("the replacer", "b")) };
const withAStaticField = class {
  static size = tell("the static field", 2);
};
function count(): number {
  return [throughATrap, replaced, withAStaticField].length;
}
console.log(count(), throughATrap.value, replaced.value, told.join());
