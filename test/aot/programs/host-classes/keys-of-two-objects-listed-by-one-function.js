function namesOf(object) {
  Object.entries(object);
  return Object.getOwnPropertyNames(object).join();
}
JSON.stringify("1");
Reflect.has({}, "a");
for (const holder of [JSON, Reflect]) console.log(namesOf(holder));
