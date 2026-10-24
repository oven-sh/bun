// Objects inside objects: repo binds impostors arrays an index loop has a caller with an impostor and then honest callers. It prints what plain Bun prints.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object" || value === null) return String(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + describe(value[key]));
  return (Array.isArray(value) ? "[" : "{") + parts.join(", ") + (Array.isArray(value) ? "]" : "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const impostors = {
  "an array-like": () => ({ 0: 7, 1: 8, length: 2 }),
  "a subclass": () => Loud.of(7, 8),
  "a string": () => "78",
  "a typed array": () => new Uint8Array([200, 100]),
  "null": () => null,
};

function run(callee, value) {
  return callee(value);
}

function usePlainly(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useByCall(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useByApply(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useBound(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useBoundToIt(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useAsACallback(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useInACallback(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useByAComputedName(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useFromAField(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useFromAnArray(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useAsAParameter(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useByReflect(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function useFromAConditional(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

for (const name in impostors) attempt("a plain call, " + name, () => (value => usePlainly(value))(impostors[name]()));
attempt("a plain call, honest site 1", () => usePlainly([1, 2, 3]));
attempt("a plain call, honest site 2", () => usePlainly([4, 5]));
attempt("a plain call, honest site 3", () => usePlainly([]));
for (let i = 0; i < 300; i++) usePlainly([i, i]);
for (const name in impostors) attempt("a plain call, again, " + name, () => (value => usePlainly(value))(impostors[name]()));
attempt("a plain call, an array by the same route", () => (value => usePlainly(value))([1, 2, 3]));
attempt("a plain call, honest site 4", () => usePlainly([6, 7, 8]));

for (const name in impostors) attempt("call, " + name, () => (value => useByCall.call(undefined, value))(impostors[name]()));
attempt("call, honest site 1", () => useByCall([1, 2, 3]));
attempt("call, honest site 2", () => useByCall([4, 5]));
attempt("call, honest site 3", () => useByCall([]));
for (let i = 0; i < 300; i++) useByCall([i, i]);
for (const name in impostors) attempt("call, again, " + name, () => (value => useByCall.call(undefined, value))(impostors[name]()));
attempt("call, an array by the same route", () => (value => useByCall.call(undefined, value))([1, 2, 3]));
attempt("call, honest site 4", () => useByCall([6, 7, 8]));

for (const name in impostors) attempt("apply, " + name, () => (value => useByApply.apply(undefined, [value]))(impostors[name]()));
attempt("apply, honest site 1", () => useByApply([1, 2, 3]));
attempt("apply, honest site 2", () => useByApply([4, 5]));
attempt("apply, honest site 3", () => useByApply([]));
for (let i = 0; i < 300; i++) useByApply([i, i]);
for (const name in impostors) attempt("apply, again, " + name, () => (value => useByApply.apply(undefined, [value]))(impostors[name]()));
attempt("apply, an array by the same route", () => (value => useByApply.apply(undefined, [value]))([1, 2, 3]));
attempt("apply, honest site 4", () => useByApply([6, 7, 8]));

for (const name in impostors) attempt("bind, " + name, () => (value => useBound.bind(undefined)(value))(impostors[name]()));
attempt("bind, honest site 1", () => useBound([1, 2, 3]));
attempt("bind, honest site 2", () => useBound([4, 5]));
attempt("bind, honest site 3", () => useBound([]));
for (let i = 0; i < 300; i++) useBound([i, i]);
for (const name in impostors) attempt("bind, again, " + name, () => (value => useBound.bind(undefined)(value))(impostors[name]()));
attempt("bind, an array by the same route", () => (value => useBound.bind(undefined)(value))([1, 2, 3]));
attempt("bind, honest site 4", () => useBound([6, 7, 8]));

for (const name in impostors) attempt("bind with the value, " + name, () => (value => useBoundToIt.bind(undefined, value)())(impostors[name]()));
attempt("bind with the value, honest site 1", () => useBoundToIt([1, 2, 3]));
attempt("bind with the value, honest site 2", () => useBoundToIt([4, 5]));
attempt("bind with the value, honest site 3", () => useBoundToIt([]));
for (let i = 0; i < 300; i++) useBoundToIt([i, i]);
for (const name in impostors) attempt("bind with the value, again, " + name, () => (value => useBoundToIt.bind(undefined, value)())(impostors[name]()));
attempt("bind with the value, an array by the same route", () => (value => useBoundToIt.bind(undefined, value)())([1, 2, 3]));
attempt("bind with the value, honest site 4", () => useBoundToIt([6, 7, 8]));

for (const name in impostors) attempt("a callback of map, " + name, () => (value => [value].map(useAsACallback)[0])(impostors[name]()));
attempt("a callback of map, honest site 1", () => useAsACallback([1, 2, 3]));
attempt("a callback of map, honest site 2", () => useAsACallback([4, 5]));
attempt("a callback of map, honest site 3", () => useAsACallback([]));
for (let i = 0; i < 300; i++) useAsACallback([i, i]);
for (const name in impostors) attempt("a callback of map, again, " + name, () => (value => [value].map(useAsACallback)[0])(impostors[name]()));
attempt("a callback of map, an array by the same route", () => (value => [value].map(useAsACallback)[0])([1, 2, 3]));
attempt("a callback of map, honest site 4", () => useAsACallback([6, 7, 8]));

for (const name in impostors) attempt("inside a callback of forEach, " + name, () => (value => { let answer; [value].forEach(element => { answer = useInACallback(element); }); return answer; })(impostors[name]()));
attempt("inside a callback of forEach, honest site 1", () => useInACallback([1, 2, 3]));
attempt("inside a callback of forEach, honest site 2", () => useInACallback([4, 5]));
attempt("inside a callback of forEach, honest site 3", () => useInACallback([]));
for (let i = 0; i < 300; i++) useInACallback([i, i]);
for (const name in impostors) attempt("inside a callback of forEach, again, " + name, () => (value => { let answer; [value].forEach(element => { answer = useInACallback(element); }); return answer; })(impostors[name]()));
attempt("inside a callback of forEach, an array by the same route", () => (value => { let answer; [value].forEach(element => { answer = useInACallback(element); }); return answer; })([1, 2, 3]));
attempt("inside a callback of forEach, honest site 4", () => useInACallback([6, 7, 8]));

for (const name in impostors) attempt("a method read by a computed name, " + name, () => (value => ({ useByAComputedName })[["use", "ByAComputedName"].join("")](value))(impostors[name]()));
attempt("a method read by a computed name, honest site 1", () => useByAComputedName([1, 2, 3]));
attempt("a method read by a computed name, honest site 2", () => useByAComputedName([4, 5]));
attempt("a method read by a computed name, honest site 3", () => useByAComputedName([]));
for (let i = 0; i < 300; i++) useByAComputedName([i, i]);
for (const name in impostors) attempt("a method read by a computed name, again, " + name, () => (value => ({ useByAComputedName })[["use", "ByAComputedName"].join("")](value))(impostors[name]()));
attempt("a method read by a computed name, an array by the same route", () => (value => ({ useByAComputedName })[["use", "ByAComputedName"].join("")](value))([1, 2, 3]));
attempt("a method read by a computed name, honest site 4", () => useByAComputedName([6, 7, 8]));

for (const name in impostors) attempt("a field, " + name, () => (value => ({ callee: useFromAField }).callee(value))(impostors[name]()));
attempt("a field, honest site 1", () => useFromAField([1, 2, 3]));
attempt("a field, honest site 2", () => useFromAField([4, 5]));
attempt("a field, honest site 3", () => useFromAField([]));
for (let i = 0; i < 300; i++) useFromAField([i, i]);
for (const name in impostors) attempt("a field, again, " + name, () => (value => ({ callee: useFromAField }).callee(value))(impostors[name]()));
attempt("a field, an array by the same route", () => (value => ({ callee: useFromAField }).callee(value))([1, 2, 3]));
attempt("a field, honest site 4", () => useFromAField([6, 7, 8]));

for (const name in impostors) attempt("an element, " + name, () => (value => [useFromAnArray][0](value))(impostors[name]()));
attempt("an element, honest site 1", () => useFromAnArray([1, 2, 3]));
attempt("an element, honest site 2", () => useFromAnArray([4, 5]));
attempt("an element, honest site 3", () => useFromAnArray([]));
for (let i = 0; i < 300; i++) useFromAnArray([i, i]);
for (const name in impostors) attempt("an element, again, " + name, () => (value => [useFromAnArray][0](value))(impostors[name]()));
attempt("an element, an array by the same route", () => (value => [useFromAnArray][0](value))([1, 2, 3]));
attempt("an element, honest site 4", () => useFromAnArray([6, 7, 8]));

for (const name in impostors) attempt("a parameter, " + name, () => (value => run(useAsAParameter, value))(impostors[name]()));
attempt("a parameter, honest site 1", () => useAsAParameter([1, 2, 3]));
attempt("a parameter, honest site 2", () => useAsAParameter([4, 5]));
attempt("a parameter, honest site 3", () => useAsAParameter([]));
for (let i = 0; i < 300; i++) useAsAParameter([i, i]);
for (const name in impostors) attempt("a parameter, again, " + name, () => (value => run(useAsAParameter, value))(impostors[name]()));
attempt("a parameter, an array by the same route", () => (value => run(useAsAParameter, value))([1, 2, 3]));
attempt("a parameter, honest site 4", () => useAsAParameter([6, 7, 8]));

for (const name in impostors) attempt("Reflect.apply, " + name, () => (value => Reflect.apply(useByReflect, undefined, [value]))(impostors[name]()));
attempt("Reflect.apply, honest site 1", () => useByReflect([1, 2, 3]));
attempt("Reflect.apply, honest site 2", () => useByReflect([4, 5]));
attempt("Reflect.apply, honest site 3", () => useByReflect([]));
for (let i = 0; i < 300; i++) useByReflect([i, i]);
for (const name in impostors) attempt("Reflect.apply, again, " + name, () => (value => Reflect.apply(useByReflect, undefined, [value]))(impostors[name]()));
attempt("Reflect.apply, an array by the same route", () => (value => Reflect.apply(useByReflect, undefined, [value]))([1, 2, 3]));
attempt("Reflect.apply, honest site 4", () => useByReflect([6, 7, 8]));

for (const name in impostors) attempt("a conditional callee, " + name, () => (value => (value === undefined ? run : useFromAConditional)(value))(impostors[name]()));
attempt("a conditional callee, honest site 1", () => useFromAConditional([1, 2, 3]));
attempt("a conditional callee, honest site 2", () => useFromAConditional([4, 5]));
attempt("a conditional callee, honest site 3", () => useFromAConditional([]));
for (let i = 0; i < 300; i++) useFromAConditional([i, i]);
for (const name in impostors) attempt("a conditional callee, again, " + name, () => (value => (value === undefined ? run : useFromAConditional)(value))(impostors[name]()));
attempt("a conditional callee, an array by the same route", () => (value => (value === undefined ? run : useFromAConditional)(value))([1, 2, 3]));
attempt("a conditional callee, honest site 4", () => useFromAConditional([6, 7, 8]));
