// Object literals hold elements in front of and behind `__proto__`, below objects with accessors under indices, proxies and typed arrays. Lists are read on both sides of the literals.
// Flags: --aot-validate
const log = [];
const withSetter = {};
Object.defineProperty(withSetter, 4, {
  set(value) {
    log.push("set " + value);
  },
  get() {
    return "got";
  },
});
const proxy = new Proxy(
  {},
  {
    set(target, key, value, receiver) {
      log.push("trap " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
  },
);

function onBothSides(above, a, b, c) {
  const made = { 0: a, 1: b, __proto__: above, 2: c, 3: a };
  made[4] = b;
  made[1] = c;
  return [made[0], made[1], made[2], made[3], made[4], Object.keys(made).join()].join(" ");
}

function behindSpread(above, list, last) {
  const made = { ...list, __proto__: above, 9: last };
  let sum = 0;
  for (let index = 0; index < list.length; index++) sum += made[index];
  made[4] = last;
  return sum + " " + Object.keys(made).join() + " " + made[4];
}

function besideList(list, above) {
  let sum = list[0] + list[1];
  const made = { 0: 1, __proto__: above };
  sum += list[0] + list[1];
  list[2] = sum;
  return sum + made[0] + list.length;
}

function withOwnAccessor(above) {
  const made = {
    set [129095936](value) {
      log.push("own " + value);
    },
    __proto__: above,
  };
  made[129095936] = 1;
  made[0] = 2;
  return Object.keys(made).join() + " " + (Object.getPrototypeOf(made) === above);
}

function chain(list, count) {
  let sum = 0;
  let above = {
    0: 1,
    set 5(value) {
      sum += value;
    },
  };
  for (let index = 0; index < count; index++) {
    sum += list[index & 1];
    const made = { 0: index, 1: index, __proto__: above };
    made[5] = 100;
    made[2] = 1;
    sum += made[0] + made[1] + made[2] + list.length;
    above = made;
    list[index & 1] = sum;
  }
  return sum;
}

for (const above of [withSetter, proxy, {}, new Int16Array(2), null, [7, 8]]) {
  for (let round = 0; round < 3; round++) {
    console.log(onBothSides(above, round, round + 1, round + 2));
    console.log(
      behindSpread(above, [1, 2, 3], round),
      behindSpread(above, [1.5, 2, 3], round),
      behindSpread(above, ["a", "b"], round),
    );
    console.log(besideList([1, 2], above), besideList([1.5, 2], above));
    console.log(withOwnAccessor(above));
  }
}
console.log(chain([1, 2], 6), chain([1.5, 2.5], 6));
console.log(log.join());
