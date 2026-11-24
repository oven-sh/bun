// Between a call and the loop, the list or the pattern that takes what it gives, a variable takes another value.
function atPath(path, object) {
  const keys = path.split(".");
  let value = object;
  for (const key of keys) value = value == null ? value : value[key];
  return value;
}
function render(text, object) {
  let out = "", i = 0;
  while (i < text.length) {
    if (text[i] === "{") {
      const end = text.indexOf("}", i);
      const keys = text.slice(i + 1, end).split(".");
      let value = object;
      for (const key of keys) value = value == null ? value : value[key];
      out += value;
      i = end + 1;
    } else out += text[i++];
  }
  return out;
}
function byMatches(text, object) {
  const matches = text.matchAll(/\w+/g);
  let value = object;
  for (const match of matches) value = value == null ? value : value[match[0]];
  return value;
}
function besideMatches(text, first) {
  const matches = text.matchAll(/\w/g);
  let kept = first;
  let count = 0;
  for (const match of matches) count += match[0].length;
  return [kept, count].join();
}
function byValues(map, object) {
  const names = map.values();
  let value = object;
  for (const name of names) value = value == null ? value : value[name];
  return value;
}
function byKeysOfSet(set, object) {
  const names = set.keys();
  let value = object;
  for (const name of names) value = value == null ? value : value[name];
  return value;
}
function byValuesOfList(list, object) {
  const names = list.values();
  let value = object;
  for (const name of names) value = value == null ? value : value[name];
  return value;
}
function byEntries(map, object) {
  const entries = map.entries();
  let value = object;
  for (const [name] of entries) value = value == null ? value : value[name];
  return value;
}
function bySpreads(maps, object) {
  let said = "";
  for (const map of maps) {
    const names = map.values();
    let value = object;
    const list = [...names];
    for (let i = 0; i < list.length; i++) value = value == null ? value : value[list[i]];
    said += JSON.stringify(value) + list.length;
  }
  return said;
}
function byPatterns(maps, object) {
  let said = "";
  for (const map of maps) {
    const names = map.values();
    let value = object;
    const [first, second] = names;
    value = value == null ? value : value[first];
    said += JSON.stringify(value) + second;
  }
  return said;
}
function lengthsWithout(texts, pattern, object) {
  let said = "";
  for (const text of texts) {
    const rest = text.replace(pattern, "");
    let value = object;
    const length = rest.length;
    value = value == null ? value : value[length];
    said += JSON.stringify(value) + length;
  }
  return said;
}

for (let i = 0; i < 2; i++) {
  console.log(atPath("a.b", { a: { b: i } }), atPath("c", { c: "Z" }), atPath("x.y", null));
  console.log(render("Hi {name}, {a.b} {x}!", { name: "Z", a: { b: i } }));
  console.log(byMatches("a b", { a: { b: i } }), byMatches("c", { c: "Z" }), byMatches("x", undefined));
  console.log(besideMatches("ab", "kept" + i), besideMatches("", i));
}
const two = new Map([[1, "a"], [2, "b"]]), one = new Map([[1, "c"]]);
console.log(byValues(two, { a: { b: 3 } }), byValues(one, { c: "Z" }));
console.log(byKeysOfSet(new Set(["a", "b"]), { a: { b: 4 } }), byKeysOfSet(new Set(["c"]), { c: "Y" }));
console.log(byValuesOfList(["a", "b"], { a: { b: 5 } }), byValuesOfList(["c"], { c: "X" }));
console.log(byEntries(new Map([["a", 1], ["b", 2]]), { a: { b: 6 } }), byEntries(new Map([["c", 1]]), { c: "W" }));
console.log(bySpreads([two, one], { a: { b: 7 }, c: "V" }), bySpreads([one], null));
console.log(byPatterns([two, one], { a: { b: 8 }, c: "U" }), byPatterns([two], null));
console.log(lengthsWithout(["abc", "a", "xyz"], /a/g, { 2: "two", 0: "none" }), lengthsWithout(["b"], /c/g, null));
