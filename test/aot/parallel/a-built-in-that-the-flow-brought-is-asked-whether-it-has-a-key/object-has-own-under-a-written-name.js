function look(object) {
  return Object.hasOwn(object, "stdout");
}
console.log(look(process), "_eventsCount" in process);
