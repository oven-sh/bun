// `o[k]`, where the compiler knows what `k` holds because a caller hands it in, is quoted as it is written: not by the name, and not as another object of the function that has a member of that name.
function tell(label, run) {
  try {
    run();
    console.log(label + ": nothing thrown");
  } catch (error) {
    console.log(label + ": " + error.message);
  }
}
function read(o, k) {
  return o[k];
}
function store(o, k) {
  o[k] = 1;
}
function anotherLineReadsTheName(o, k, other) {
  const name = other.name;
  return o[k] + name;
}
function sameLineReadsTheName(o, k, other) {
  return other.name + o[k];
}
tell("read", () => read(undefined, "name"));
tell("store", () => store(null, "name"));
tell("another line reads the name", () => anotherLineReadsTheName(null, "name", {}));
tell("the same line reads the name", () => sameLineReadsTheName(null, "name", {}));
