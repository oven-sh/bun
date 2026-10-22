function tailOf([head, ...tail]) {
  return tail.length;
}
console.log(Object.keys({ b: 2 }).join(), tailOf([1, 2]), tailOf([3, 4]));
