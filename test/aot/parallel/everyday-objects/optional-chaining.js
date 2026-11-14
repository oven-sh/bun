// Optional chaining over records that miss parts at each level
function city(person, calls) {
  const text = person?.address?.city ?? "nowhere";
  const first = person?.friends?.[0]?.name?.toUpperCase();
  const said = person?.say?.(calls.push("said"));
  return [text, first, said, calls.length].map(String).join("/");
}
function visit(name) {
  const calls = [];
  const people = [{ name, address: { city: name + "ville" }, say: n => n * 2 }, { friends: [{ name }] }, { address: {} }, null];
  return people.map(person => city(person, calls)).join(" ");
}
console.log(visit("ann"));
console.log(visit("bob"));
console.log(visit("z"));
