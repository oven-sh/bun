class Lamp {
  constructor(value) {
    this.value = value;
  }
  read() {
    return this.value;
  }
}
const usual = { poles: 4, cloth: "linen", smoke: null, lamp: null, depth: 1 };
function pitch(wishes) {
  const tent = {};
  for (const part in usual) {
    if (wishes === null || wishes === undefined || !Object.hasOwn(wishes, part)) tent[part] = usual[part];
    else tent[part] = wishes[part];
  }
  if (tent.poles > 5) tent.cloth = tent.cloth + " twice";
  return tent;
}
function show(tent) {
  const link = Object.getPrototypeOf(tent);
  return (link === Object.prototype ? "plain" : link === null ? "null" : "other") + " " + Object.keys(tent).join() + " " + tent.cloth + " " + typeof tent.smoke + " " + (tent.lamp?.read() ?? tent.lamp);
}
for (let i = 0; i < 6; i++) {
  console.log(show(pitch({ lamp: new Lamp(i), cloth: i & 1 ? "silk" : undefined, unknown: 1, poles: i * 2, smoke: i === 3 ? () => 1 : null })));
  console.log(show(pitch(i & 1 ? null : undefined)), show(pitch({})), show(pitch({ __proto__: { lamp: new Lamp(9) } })));
}
console.log(pitch({ lamp: new Lamp(5) }).lamp.read());

function copy(from, to) {
  for (const name in from) to[name] = from[name];
  return to;
}
const owns = JSON.parse('{ "a": 1, "__proto__": { "b": 2 } }');
const spelled = { a: 1, ["__proto__"]: new Lamp(3) };
const defined = Object.defineProperty({ a: 1 }, "__proto__", { value: new Lamp(4), enumerable: true, configurable: true, writable: true });
const below = Object.create({ a: 1, ["__proto__"]: new Lamp(6) });
const late = { a: 1 };
for (const from of [owns, spelled, defined, below, late, "text", 5, null]) {
  const to = copy(from, { first: 0 });
  console.log(Object.keys(to).join(), Object.getPrototypeOf(to) === Object.prototype, typeof to.read, typeof to.b);
}
late["__pro" + "to__"] = new Lamp(7);
late.b = 2;
console.log(Object.keys(copy(late, {})).join(), typeof copy(late, {}).read);

const table = { x: 1, y: 2 };
function fillFrom(source, value) {
  const made = {};
  for (const name in source) made[name] = value;
  return made;
}
console.log(Object.keys(fillFrom(table, new Lamp(1))).join(), fillFrom(table, new Lamp(2)).y.read());
table["__proto__"] = { z: 3 };
console.log(Object.keys(fillFrom(table, new Lamp(1))).join(), fillFrom(table, new Lamp(2)).z.read(), Object.getPrototypeOf(fillFrom(table, new Lamp(1))) === Object.prototype);
Object.defineProperty(table, "__proto__", { value: 1, enumerable: true });
console.log(Object.keys(fillFrom(table, new Lamp(1))).join(), fillFrom(table, new Lamp(8)).value);
