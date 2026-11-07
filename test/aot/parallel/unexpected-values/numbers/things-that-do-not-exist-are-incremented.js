function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function missingMember() {
  const object = {};
  const result = object.count++;
  return [result, object.count, Object.keys(object)];
}

function missingElement() {
  const list = [1, 2];
  const result = ++list[3];
  return [result, list];
}

function hole() {
  const list = [1, , 3];
  list[1] += 1;
  return list;
}

function uninitializedVariable() {
  let n;
  n++;
  return n;
}

function uninitializedThenAdded() {
  let total;
  for (let i = 0; i < 3; i++) total += i;
  return total;
}

function missingArgument(n) {
  n += 1;
  return n;
}

function nullMember() {
  const object = { count: null };
  object.count++;
  return object.count;
}

function memberOfNull() {
  const object = null;
  object.count++;
}

function memberOfANumber() {
  const n = 5;
  const result = n.count++;
  return [result, n.count];
}

function inheritedMember() {
  const object = Object.create({ count: 5 });
  object.count++;
  return [object.count, Object.getPrototypeOf(object).count, Object.keys(object)];
}

function inheritedReadOnlyMember() {
  const object = Object.create(Object.freeze({ count: 5 }));
  const result = object.count++;
  return [result, object.count, Object.keys(object)];
}

function getterOnly() {
  const object = {
    get count() {
      return 5;
    },
  };
  const result = ++object.count;
  return [result, object.count];
}

function lengthOfAnArray() {
  const list = [1, 2];
  list.length++;
  return list;
}

function lengthOfAnEmptyArrayDecremented() {
  const list = [];
  list.length--;
  return list;
}

function lengthOfAText() {
  const text = ["a", "b"].join("");
  const result = text.length++;
  return [result, text.length];
}

function undeclaredName() {
  return neverDeclaredAnywhere++;
}

function typedArrayPastTheEnd() {
  const list = new Int32Array(1);
  const result = list[5]++;
  return [result, list[5], list.length];
}

function mapEntry() {
  const map = new Map();
  map.count++;
  return [map.count, map.size];
}

const uses = [missingMember, missingElement, hole, uninitializedVariable, uninitializedThenAdded, missingArgument, nullMember, memberOfNull, memberOfANumber, inheritedMember, inheritedReadOnlyMember, getterOnly, lengthOfAnArray, lengthOfAnEmptyArrayDecremented, lengthOfAText, undeclaredName, typedArrayPastTheEnd, mapEntry];
for (const round of ["first", "second", "third"]) for (const use of uses) attempt(round + " " + use.name, use);
