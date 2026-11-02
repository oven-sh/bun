// Objects get one more name under a key that is known only at run time. A rest pattern leaves out the name that most of them get, and keeps the name that the next one gets: whether one object is taken apart several times or many are in a row, and with collections forced too.
// Env of the executable: BUN_JSC_forceFencedBarrier=1
// Erased types: not built: rests-leave-name-object-got-key-name is built so
type Key = string | symbol;
interface Five {
  f1: number;
  f2: number;
  f3: number;
  f4: number;
  f5: number;
  [key: string]: number;
  [key: symbol]: number;
}
class Holder {
  f1 = 1;
  f2 = 2;
  f3 = 3;
  [key: string]: number;
  [key: symbol]: number;
}

function show(object: any): string {
  return Reflect.ownKeys(object)
    .map(key => String(key) + "=" + String(object[key]))
    .join();
}

function keyFirst(key: Key, times: number): string {
  const one: Five = { [key]: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5 };
  let shown = "";
  for (let turn = 0; turn < times; turn++) {
    const { f0, ...rest } = one;
    shown = show(rest);
  }
  return shown;
}

function keyLast(key: Key, times: number): string {
  const one: Five = { f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, [key]: 0 };
  let shown = "";
  for (let turn = 0; turn < times; turn++) {
    const { f0, f5: last, ...rest } = one;
    shown = f0 + ":" + last + ":" + show(rest);
  }
  return shown;
}

function storedLater(key: Key, times: number): string {
  const one: Five = { f1: 1, f2: 2, f3: 3, f4: 4, f5: 5 };
  one[key] = 0;
  return show(new Array(times).fill(one).map(({ f0, ...rest }) => rest)[times - 1]);
}

function withoutUsualName({ f0, ...rest }: Holder) {
  return rest;
}
function instance(key: Key, times: number): string {
  const one = new Holder();
  one[key] = 0;
  let shown = "";
  for (let turn = 0; turn < times; turn++) shown = show(withoutUsualName(one));
  return shown;
}

function restOfRest(key: Key, times: number): string {
  const one: Five = { [key]: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5 };
  let shown = "";
  for (let turn = 0; turn < times; turn++) {
    const { f1, ...middle } = one;
    const { f0, ...rest } = middle;
    shown = f1 + ":" + show(rest);
  }
  return shown;
}

const keys: Key[] = ["f0", "f6", "f0", "f0", Symbol("s"), "f0", "f7", "f7", "f0", "", "f0", "f2", "f8"];
for (const times of [3, 1, 2]) {
  for (const key of keys) {
    console.log(times, String(key), "first", keyFirst(key, times));
    console.log(times, String(key), "last", keyLast(key, times));
    console.log(times, String(key), "later", storedLater(key, times));
    console.log(times, String(key), "instance", instance(key, times));
    console.log(times, String(key), "twice", restOfRest(key, times));
  }
}

const usual: string[] = [];
for (let turn = 0; turn < 300; turn++) usual[0] = keyFirst("f0", 1);
console.log(usual[0], keyFirst("g1", 1));
for (let turn = 0; turn < 300; turn++) usual[0] = keyLast("f0", 1);
console.log(usual[0], keyLast("g2", 1));
for (let turn = 0; turn < 300; turn++) usual[0] = storedLater("f0", 1);
console.log(usual[0], storedLater("g3", 1));
for (let turn = 0; turn < 300; turn++) usual[0] = instance("f0", 1);
console.log(usual[0], instance("g4", 1));
for (let turn = 0; turn < 300; turn++) usual[0] = restOfRest("f0", 1);
console.log(usual[0], restOfRest("g5", 1));
