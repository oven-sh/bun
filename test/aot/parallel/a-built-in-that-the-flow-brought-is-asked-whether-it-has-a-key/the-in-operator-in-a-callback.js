function list(object) {
  return ["_events", "stdout", "nothing"].filter(name => name in object).length;
}
console.log(list(process) === 1, "_eventsCount" in process);
