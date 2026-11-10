function look(object) {
  return "stdout" in object;
}
console.log(look(process), "_eventsCount" in process);
