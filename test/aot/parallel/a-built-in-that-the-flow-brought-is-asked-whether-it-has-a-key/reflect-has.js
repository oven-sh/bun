function has(object, name) {
  return Reflect.has(object, name);
}
console.log(has(process, "stdout"), "_eventsCount" in process);
