function namesOf(object) {
  Object.entries(object);
  return Object.getOwnPropertyNames(object).join();
}
JSON.stringify(1);
console.log(namesOf(JSON.parse(process.argv.length > 5 ? "[]" : '{"a":1}')), namesOf(JSON));
