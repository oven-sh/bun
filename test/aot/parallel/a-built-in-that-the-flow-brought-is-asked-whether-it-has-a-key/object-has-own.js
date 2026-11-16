function has(object, name) {
  return Object.hasOwn(object, name);
}
console.log(has(process, "stdout"), "_eventsCount" in process);
