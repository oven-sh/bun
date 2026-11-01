// `search` with a frozen pattern that is global or sticky throws: exec stores lastIndex, also where the store would leave it as it was.
function ask(make) {
  try {
    return String(make());
  } catch (error) {
    return error.name;
  }
}
const kept = Object.freeze(/(?:)/gm);
console.log(
  "matches at 0, global",
  ask(() => "12 345 6".search(kept)),
);
console.log(
  "matches later, global",
  ask(() => "12 345 6".search(Object.freeze(/3/g))),
);
console.log(
  "matches later, global, a class",
  ask(() => "12 345 6".search(Object.freeze(/[3-5]+ /g))),
);
console.log(
  "matches nowhere, global",
  ask(() => "12 345 6".search(Object.freeze(/x\d/g))),
);
console.log(
  "matches nowhere, sticky",
  ask(() => "12 345 6".search(Object.freeze(/3/y))),
);
console.log(
  "matches at 0, sticky",
  ask(() => "12 345 6".search(Object.freeze(/\d\d /y))),
);
console.log(
  "neither global nor sticky",
  ask(() => "12 345 6".search(Object.freeze(/3/))),
);
console.log(
  "neither, a class",
  ask(() => "12 345 6".search(Object.freeze(/[3-5]+ /))),
);
console.log(
  "neither, matches nowhere",
  ask(() => "12 345 6".search(Object.freeze(/x\d/))),
);
console.log(
  "sealed, sticky",
  ask(() => "12 345 6".search(Object.seal(/3/y))),
);
console.log(
  "sealed, global",
  ask(() => "12 345 6".search(Object.seal(/[3-5]+ /g))),
);
console.log(
  "lastIndex alone is read-only, sticky",
  ask(() => "12 345 6".search(Object.defineProperty(/\d\d /y, "lastIndex", { writable: false }))),
);
console.log(
  "lastIndex alone is read-only, neither",
  ask(() => "12 345 6".search(Object.defineProperty(/[3-5]+ /, "lastIndex", { writable: false }))),
);
function searchTwice(pattern) {
  return ask(() => "12 345 6".search(pattern)) + " " + ask(() => "12 345 6".search(pattern));
}
const later = /[3-5]+ /g;
console.log("before it is frozen", searchTwice(later), later.lastIndex);
Object.freeze(later);
console.log("behind that", searchTwice(later), later.lastIndex);
