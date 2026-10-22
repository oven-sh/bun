function double(value) {
  return value * 2;
}
const doubled = Array.prototype.map.call([1.5, 2], double);
console.log(doubled[0] + 1, doubled[1] + 1);
