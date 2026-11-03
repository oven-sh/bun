// new Set(array) over int32, double and any-value storage: duplicates, -0 and 0, whole doubles beside int32s, NaN, holes, every size of table, and what is done to the set afterwards.
const lines = [];
const show = value => (Object.is(value, -0) ? "-0" : String(value));
const describe = set => `${set.size}: ${Array.from(set, show).join(" ")}`;
function check(name, array) {
  const set = new Set(array);
  const model = new Set();
  for (const element of array) model.add(element);
  lines.push(`${name}: ${describe(set).slice(0, 120)} ${describe(set) === describe(model) ? "as added one by one" : "DIFFERS FROM " + describe(model).slice(0, 120)}`);
  return set;
}

check("int32s", [1, 2, 3, 2, 1]);
check("one", [9]);
check("same", [4, 4, 4]);
check("empty", []);
check("negative", [-1, -2147483648, 2147483647, -1, 0]);
check("doubles", [1.5, 2.5, 1.5, -0.5, 1e300, -1e300, 5e-324]);
check("whole doubles", [1.5, 2, 2.0, 3, 1.5, 4294967296, 4294967296, -4294967296]);
check("zeros", [0.5, -0, 0, -0]);
check("infinities", [0.5, Infinity, -Infinity, Infinity]);
check("with NaN", [1.5, NaN, NaN, 0 / 0]);
check("int32s with a hole", [1, , 3, , 1]);
check("doubles with a hole", [1.5, , 3.5, , 1.5]);
check("mixed", [1, "1", 1.5, true, null, undefined, 1, "1"]);

const whole = [0.5];
whole.pop();
for (let i = 0; i < 6; i++) whole.push(i % 3);
check("int32s in double storage", whole);

for (const size of [2, 4, 5, 8, 9, 16, 17, 64, 65, 254, 255, 256, 1000, 5000, 70000]) {
  check(`distinct int32s ${size}`, Array.from({ length: size }, (_, i) => i * 7 - size));
  check(`distinct doubles ${size}`, Array.from({ length: size }, (_, i) => i * 0.25 + 0.125));
  check(`few among ${size}`, Array.from({ length: size }, (_, i) => i % 5));
  check(`few doubles among ${size}`, Array.from({ length: size }, (_, i) => (i % 5) + 0.5));
  check(`half among ${size}`, Array.from({ length: size }, (_, i) => i >> 1));
}

for (const size of [3, 8, 9, 300, 3000]) {
  const set = check(`changed later ${size}`, Array.from({ length: size }, (_, i) => i % 200));
  const before = set.size;
  lines.push([set.has(0), set.has(-0), set.has(1), set.has(1.0), set.has(199), set.has(200), set.has(0.5), set.has("1")].join());
  for (let i = 0; i < 40; i++) set.add(i + 0.5);
  set.add("text");
  set.add(set);
  for (let i = 0; i < size; i += 2) set.delete(i);
  lines.push(`${before} > ${set.size}: ${Array.from(set, value => (value === set ? "itself" : show(value))).slice(0, 12).join(" ")}`);
  let walked = 0;
  for (const value of set) {
    if (walked++ < 3) set.add(-walked);
  }
  lines.push(`${walked} walked, ${set.size}`);
  set.clear();
  lines.push(describe(set));
}

const source = [1, 2, 3];
const copy = new Set(source);
source.push(4);
source[0] = 9;
lines.push(describe(copy));

class Counted extends Set {
  added = 0;
  add(value) {
    this.added = (this.added ?? 0) + 1;
    return super.add(value);
  }
}
const counted = new Counted([1, 1.5, 1]);
lines.push(`${describe(counted)} ${counted.added}`);

class Odd extends Array {
  *[Symbol.iterator]() {
    yield "odd";
  }
}
lines.push(describe(new Set(Odd.from([1, 2]))));
const own = [1.5, 2.5];
own[Symbol.iterator] = function* () {
  yield "own";
};
lines.push(describe(new Set(own)));
lines.push(describe(new Set(Object.freeze([1, 2, 2]))));
lines.push(describe(new Set(Object.freeze([1.5, 2.5, 2.5]))));

console.log(lines.join("\n"));
