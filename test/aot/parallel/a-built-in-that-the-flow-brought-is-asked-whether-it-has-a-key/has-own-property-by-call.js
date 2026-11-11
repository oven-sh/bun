function has(object, name) {
  return Object.prototype.hasOwnProperty.call(object, name);
}
console.log(has(process, "stdout"), "_eventsCount" in process);
