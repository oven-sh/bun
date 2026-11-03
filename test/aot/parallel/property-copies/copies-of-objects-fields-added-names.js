// An object that has the members of its literal and names that were added later is copied with every own enumerable property, in the order of creation.
const lines = [];
const show = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const { value, get, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(object, key);
      return String(key) + "=" + (get ? "getter" : String(value)) + (writable && enumerable && configurable ? "" : "!");
    })
    .join(",");

const tag = Symbol("tag");
const names = JSON.parse('["late","later","latest"]');

function record(i) {
  return { x: i, y: i + 1 };
}

function withAddedNames(i, count) {
  const object = record(i);
  for (let n = 0; n < count; n++) object[names[n]] = i + n;
  return object;
}

const copy = source => ({ ...source });
const extend = source => ({ ...source, z: 1 });
const assign = source => Object.assign({}, source);
const assignOnto = source => Object.assign({ y: 0, w: 0 }, source);
const rest = ({ x, ...others }) => others;
const forms = { copy, extend, assign, assignOnto, rest };

function total(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const source = withAddedNames(i, 2);
    const copied = copy(source);
    const extended = extend(copied);
    sum += copied.x + copied.late + extended.later + extended.z + assignOnto(source).late;
  }
  return sum;
}
lines.push(String(total(3000)));

const sources = {
  none: () => withAddedNames(1, 0),
  one: () => withAddedNames(1, 1),
  three: () => withAddedNames(1, 3),
  otherOrder: () => {
    const object = record(1);
    object[names[1]] = 1;
    object[names[0]] = 2;
    return object;
  },
  getter: () => Object.defineProperty(withAddedNames(1, 1), "computed", { get: () => 7, enumerable: true, configurable: true }),
  notEnumerable: () => Object.defineProperty(withAddedNames(1, 1), "hidden", { value: 7, enumerable: false, writable: true, configurable: true }),
  readOnly: () => Object.defineProperty(withAddedNames(1, 1), "fixed", { value: 7, enumerable: true, writable: false, configurable: true }),
  symbol: () => Object.assign(withAddedNames(1, 1), { [tag]: 7 }),
  index: () => Object.assign(withAddedNames(1, 1), { 3: "three", 1: "one" }),
  deletedField: () => {
    const object = withAddedNames(1, 2);
    delete object.x;
    return object;
  },
  fieldCreatedOnceMore: () => {
    const object = withAddedNames(1, 2);
    delete object.x;
    object.x = 9;
    return object;
  },
  deletedName: () => {
    const object = withAddedNames(1, 3);
    delete object.later;
    return object;
  },
  fieldOfAnotherType: () => {
    const object = withAddedNames(1, 1);
    object.x = "text";
    return object;
  },
  fieldMadeAccessor: () => Object.defineProperty(withAddedNames(1, 1), "y", { get: () => 7, enumerable: true, configurable: true }),
  frozen: () => Object.freeze(withAddedNames(1, 2)),
  sealed: () => Object.seal(withAddedNames(1, 2)),
  many: () => {
    const object = record(1);
    for (let n = 0; n < 80; n++) object["name" + n] = n;
    return object;
  },
};

for (const [sourceName, make] of Object.entries(sources)) {
  for (const [formName, form] of Object.entries(forms)) {
    // Twice: the second copy may be served by what the first one left behind.
    const first = show(form(make()));
    const second = show(form(make()));
    lines.push(sourceName + " " + formName + " " + (first === second ? first.length > 200 ? first.length : first : "DIFFERENT " + first + " | " + second));
  }
}

// One site, sources whose added names differ from turn to turn.
for (let i = 0; i < 12; i++) lines.push(show(copy(withAddedNames(i, i % 4))));

// Names that come from data precede the member of the literal, in the literal and in every copy of it.
const parsed = JSON.parse('[{"a":1,"b":2,"c":3},{"c":4,"a":5}]');
function replaceMember(turns, first) {
  let state = { ...first, z: 0 };
  for (let i = 0; i < turns; i++) state = { ...state, z: i };
  return state;
}
function betweenData(turns) {
  let state = { ...parsed[0], m: 1, ...parsed[1], d: 2, n: 3 };
  for (let i = 0; i < turns; i++) state = { ...state, n: i };
  return state;
}
function restOfData(turns) {
  let sum = 0;
  let last;
  for (let i = 0; i < turns; i++) {
    const { a, ...others } = parsed[i & 1];
    const { c, z, ...fewer } = { ...others, z: i, y: a };
    sum += a + c + z + fewer.y;
    last = [others, fewer];
  }
  return sum + " " + last.map(show).join(" | ");
}
function restByKey(object, key) {
  const { [key]: taken, ...others } = object;
  return String(taken) + " " + show(others);
}
lines.push(show(replaceMember(2000, parsed[0])), show(replaceMember(2000, parsed[1])), show(betweenData(2000)), restOfData(2000));
for (const key of ["x", "late", "later", "missing", "0", tag]) lines.push(restByKey(withAddedNames(1, 2), key), restByKey(withAddedNames(1, 2), typeof key === "string" ? key.slice(0, 2) + key.slice(2) : key));

// The copy is independent of its source.
const source = withAddedNames(1, 2);
const copied = copy(source);
source[names[0]] = "changed";
source.x = "changed";
lines.push(show(copied), show(source));

console.log(lines.join("\n"));
