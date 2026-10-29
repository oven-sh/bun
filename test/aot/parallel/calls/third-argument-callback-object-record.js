// An array method borrowed for what is a string at one call and a record at another hands its callback the String object made from the string: it is no record, and nothing of a record is read out of it.
function lengths(receiver) {
  return Array.prototype.map.call(receiver, (each, index, whole) => whole.length).join();
}
console.log(lengths("ab"), "|", lengths({ length: 1, 0: "x" }));

for (const method of ["map", "forEach", "filter", "some", "every", "find", "findIndex", "findLast", "flatMap"]) {
  const seen = [];
  const visit = receiver => Array.prototype[method].call(receiver, (each, index, whole) => (seen.push(typeof whole, whole.length, whole[index], whole.a), method === "every"));
  visit("ab");
  visit({ length: 1, 0: "x", a: 1 });
  console.log(method, seen.join());
}
