const tools = { has: Object.hasOwn };
function has(object, name) {
  return tools.has(object, name);
}
console.log(has(process, "stdout"), "_eventsCount" in process);
