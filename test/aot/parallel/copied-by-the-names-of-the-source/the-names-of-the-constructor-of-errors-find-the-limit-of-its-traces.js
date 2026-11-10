function copy(target, source) {
  for (const key in source) target[key] = source[key];
  return target;
}
const copied = copy({}, [JSON.parse("{}"), Error][1]);
console.log(`${typeof copied.stackTraceLimit} ${Object.keys(copied).includes("prototype")}`);
