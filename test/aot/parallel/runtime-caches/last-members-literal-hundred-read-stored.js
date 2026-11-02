// An object literal with over a hundred members is the prototype of other objects. Its members under symbols come last in it. They are read, tested for, stored to and called through the heirs,
// each several times, before and after the literal itself is stored to.
function make(index) {
  return index % 3 === 0 ? "text " + index : index % 3 === 1 ? index + 0.5 : ["list", index];
}
const first = Symbol("first"), second = Symbol("second"), third = Symbol("third"), fourth = Symbol("fourth"), computed = Symbol("computed"), method = Symbol("method");
const large = {
  [first]: make(100), [second]: make(101),
  m0: make(0), m1: make(1), m2: make(2), m3: make(3), m4: make(4), m5: make(5), m6: make(6), m7: make(7), m8: make(8), m9: make(9),
  m10: make(10), m11: make(11), m12: make(12), m13: make(13), m14: make(14), m15: make(15), m16: make(16), m17: make(17), m18: make(18), m19: make(19),
  m20: make(20), m21: make(21), m22: make(22), m23: make(23), m24: make(24), m25: make(25), m26: make(26), m27: make(27), m28: make(28), m29: make(29),
  m30: make(30), m31: make(31), m32: make(32), m33: make(33), m34: make(34), m35: make(35), m36: make(36), m37: make(37), m38: make(38), m39: make(39),
  m40: make(40), m41: make(41), m42: make(42), m43: make(43), m44: make(44), m45: make(45), m46: make(46), m47: make(47), m48: make(48), m49: make(49),
  m50: make(50), m51: make(51), m52: make(52), m53: make(53), m54: make(54), m55: make(55), m56: make(56), m57: make(57), m58: make(58), m59: make(59),
  m60: make(60), m61: make(61), m62: make(62), m63: make(63), m64: make(64), m65: make(65), m66: make(66), m67: make(67), m68: make(68), m69: make(69),
  m70: make(70), m71: make(71), m72: make(72), m73: make(73), m74: make(74), m75: make(75), m76: make(76), m77: make(77), m78: make(78), m79: make(79),
  m80: make(80), m81: make(81), m82: make(82), m83: make(83), m84: make(84), m85: make(85), m86: make(86), m87: make(87), m88: make(88), m89: make(89),
  m90: make(90), m91: make(91), m92: make(92), m93: make(93), m94: make(94), m95: make(95), m96: make(96), m97: make(97), m98: make(98), m99: make(99),
  [third]: make(102), [fourth]: make(103),
  get [computed]() { return "computed for " + (this === large ? "the literal" : "an heir") + " from " + this.m98; },
  set [computed](value) { this.m98 = value; },
  [method](suffix) { return this[fourth] + suffix; },
};
function read(object) {
  return [object[first], object[second], object[third], object[fourth], object[computed], object.m0, object.m99, third in object, Object.hasOwn(object, third)].join(" | ");
}
function call(object) {
  return typeof object[method] === "function" ? object[method]("!") : "no method";
}
function store(object, value) {
  try {
    object[second] = value;
  } catch (error) {
    console.log(error.constructor.name);
  }
  object[computed] = value;
  return [object[second], object.m98, Object.hasOwn(object, second), Object.hasOwn(object, "m98")].join(" | ");
}
// Whoever is handed these functions may call them with anything.
for (const reader of [read, call, store]) clearTimeout(setTimeout(reader, 1000));
console.log(JSON.stringify(large).length, Object.getOwnPropertySymbols(large).length);

class Heir {}
Object.setPrototypeOf(Heir.prototype, large);
const makers = [
  () => Object.setPrototypeOf(JSON.parse("{}"), large),
  () => Object.create(large),
  () => Object.create(JSON.parse("[0]").map(() => large)[0]),
  () => Object.create(Object.create(large)),
  () => ({ __proto__: large }),
  () => ({ __proto__: large, [third]: "of the heir" }),
  () => new Heir(),
  () => Object.setPrototypeOf(function () {}, large),
  () => Object.setPrototypeOf([], large),
  () => Object.setPrototypeOf(new Map(), large),
  () => JSON.parse('{"m0":1,"m99":2}'),
  () => large,
];
for (let round = 0; round < 4; round++) {
  const heirs = makers.map(maker => maker());
  for (const heir of heirs) console.log(round, read(heir), "|", call(heir));
  large[first] = "stored in round " + round;
  large[fourth] = round;
  for (const heir of heirs) console.log(round, read(heir), "|", call(heir));
  if (round === 1) for (const heir of heirs) console.log(round, store(heir, "stored through " + heirs.indexOf(heir)));
  if (round === 2) delete large[third];
  if (round === 2) Object.defineProperty(large, second, { value: "read-only", writable: false });
  if (round === 3) for (const heir of heirs) console.log(round, store(heir, "stored late through " + heirs.indexOf(heir)));
}
