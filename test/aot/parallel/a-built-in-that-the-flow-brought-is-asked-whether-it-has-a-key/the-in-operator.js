function has(object, name) {
  return name in object;
}
console.log(has(process, "stdout"), "_eventsCount" in process);
