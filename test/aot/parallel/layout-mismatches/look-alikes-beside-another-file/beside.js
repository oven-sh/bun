function print(text) {
  console.log(text);
}
// untyped: classes, records, readers, captured-variables, store-other-kind-in-static, delete-property
let checksum = 0;
function mix(value) {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}
const log = [];
function flush(label) {
  print(label + " " + log.length + " " + log.slice(-30).join(" "));
  log.length = 0;
}
function errorName(error) {
  if (!(error instanceof Error)) return "thrown " + String(error);
  if (error.message.includes("checks types at run time")) return error.constructor.name + " of a type check";
  if (error.message.includes("compiled executable")) return error.constructor.name + " of a locked built-in";
  return error.constructor.name + (error.message.startsWith("own ") ? "(" + error.message + ")" : "");
}
function attempt(compute) {
  try {
    print(compute());
  } catch (error) {
    print("threw " + errorName(error));
  }
}
class C1 {
  label = ("a" + "x,y");
  count;
  #secret = 5;
  static made = 0;
  constructor(a0) {
    this.count = a0;
    C1.made++;
  }
  step() {
    log.push("" + Math.min(this.#secret, (this.#secret & this.#secret)));
    return this.#secret;
  }
}
const o2 = new C1(((-1) << 21));
print("see3 " + typeof o2.label + ":" + String(o2.label) + " " + typeof o2.count + ":" + String(o2.count));
print("see3 step " + typeof o2.step() + ":" + String(o2.step()));
const r5 = { x: " pad ".toLowerCase(), flag: (((-7) * (-1)) | 0), weight: ((1 - 7) | 0), size: (typeof (-2147483648)) };
const r6 = r5;
const r7 = { x: String.fromCharCode(65 + (3 & 15)), flag: r5.flag, weight: r6.x, size: String.fromCharCode(65 + (3 & 15)) };
print("see8 " + r6.x + " " + typeof r6.flag + ":" + String(r6.flag) + " " + typeof r6.weight + ":" + String(r6.weight) + " " + r6.size.length + ":" + r6.size);
print("see8 keys " + (() => { let keys = ""; for (const key in r6) keys += key + ","; return keys; })());
function read9(o) {
  return typeof o.count + ":" + String(o.count) + ";" + (((-2147483648) << 28) | 0).toString(2).length + ":" + (((-2147483648) << 28) | 0).toString(2);
}
for (let i = 0; i < 50; i++) mix(read9(o2).length);
print("read9 " + read9(o2));
function makeBox17(start) {
  let state = start;
  return {
    read: () => state,
    write(value) {
      state = value;
    },
    bump: () => state++,
    add: (value) => (state += value),
  };
}
const box18 = makeBox17(255);
const box18Other = makeBox17((-7));
for (let i = 0; i < 2; i++) mix(box18.bump() + box18.add(i));
print("box18 " + box18.read() + " " + box18Other.read());
(function () {
  box18.write("");
}).call(undefined);
print("box18 " + typeof box18.read() + " " + String(box18.bump()) + " " + String(box18.read()) + " " + String(box18.add(1)) + " " + box18Other.bump());
print("at20 " + (((r5.weight | 0) * (o2.count | 0)) | 0));
class Counter21 {
  static count = 1073741823;
  static bump() {
    return Counter21.count++;
  }
}
function readCount22() {
  return typeof Counter21.count + ":" + String(Counter21.count);
}
for (let i = 0; i < 3; i++) mix(Counter21.bump());
print("readCount22 " + readCount22());
Reflect.construct(function () {
  ({}).constructor.assign(Counter21, { count: null });
}, []);
print("readCount22 " + readCount22() + " " + String(Counter21.bump()) + " " + readCount22());
Reflect.apply(() => {
  delete o2.count;
  o2.count = r5.size;
}, undefined, []);
attempt(() => "see25 " + typeof o2.label + ":" + String(o2.label) + " " + typeof o2.count + ":" + String(o2.count));
attempt(() => "see25 keys " + Object.keys(o2).join());
attempt(() => "see25 step " + typeof o2.step() + ":" + String(o2.step()));
try {
  print("read9 again " + read9(o2));
} catch (error) {
  print("caught26 " + errorName(error));
}
print("keys27 " + (() => { let keys = ""; for (const key in o2) keys += key + ","; return keys; })() + " " + ("count" in o2));
attempt(() => "see63 " + r5.x.length + ":" + r5.x + " " + typeof r5.flag + ":" + String(r5.flag) + " " + typeof r5.weight + ":" + String(r5.weight) + " " + r5.size.length + ":" + r5.size);
attempt(() => "see63 keys " + (() => { let keys = ""; for (const key in r5) keys += key + ","; return keys; })());
try {
  print("see64 " + r6.x.length + ":" + r6.x + " " + typeof r6.flag + ":" + String(r6.flag) + " " + typeof r6.weight + ":" + String(r6.weight) + " " + r6.size);
  print("see64 keys " + Object.keys(r6).join());
} catch (error) {
  print("caught65 " + errorName(error));
}
attempt(() => "see66 " + typeof o2.label + ":" + String(o2.label) + " " + typeof o2.count + ":" + String(o2.count));
attempt(() => "see66 keys " + (() => { let keys = ""; for (const key in o2) keys += key + ","; return keys; })());
attempt(() => "see66 step " + typeof o2.step() + ":" + String(o2.step()));
flush("log");
print("checksum " + checksum);

export {};
