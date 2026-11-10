function has(object, name) {
  return Reflect.apply(Object.prototype.propertyIsEnumerable, object, [name]);
}
console.log(has(process, "stdout"), "_eventsCount" in process);
