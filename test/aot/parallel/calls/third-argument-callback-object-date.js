// The String object that an array method makes from a string is not taken for the other kind of object that the same call is given elsewhere.
function kinds(receiver) {
  const seen = [];
  Array.prototype.forEach.call(receiver, (each, index, whole) => seen.push(typeof whole.valueOf(), whole instanceof String, whole instanceof Date));
  return seen.join();
}
console.log(kinds("ab"), "|", kinds(new Date(0)));

function sources(receiver) {
  return Array.prototype.map.call(receiver, (each, index, whole) => String(whole.source) + whole.length).join();
}
console.log(sources("ab"), "|", sources(/a/));

function messages(receiver) {
  return Array.prototype.filter.call(receiver, (each, index, whole) => whole.message === undefined).join();
}
console.log(messages("ab"), "|", messages(new Error("e")));
