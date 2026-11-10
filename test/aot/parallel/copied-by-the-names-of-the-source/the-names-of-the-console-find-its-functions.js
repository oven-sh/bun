function copy(target, source) {
  for (const key in source) target[key] = source[key];
  return target;
}
const copied = copy({}, [JSON.parse("{}"), console][1]);
copied.log(`${typeof copied.takeHeapSnapshot} ${typeof copied.table} made up`);
