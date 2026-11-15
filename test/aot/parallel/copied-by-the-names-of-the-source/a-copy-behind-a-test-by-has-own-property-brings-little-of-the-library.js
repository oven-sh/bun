// STATISTIC: ImageFunctionsEmitted <= 40
function copy(target, source) {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  }
  return target;
}
const copied = copy({}, JSON.parse('{"made":"up","deep":{"er":1}}'));
console.log(`${copied.made} ${copied.deep.er}`);
