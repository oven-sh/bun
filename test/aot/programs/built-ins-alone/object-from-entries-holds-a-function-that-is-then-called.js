function work(value) {
  return value + 1;
}
console.log(Object.fromEntries([["work", work]]).work(1.5));
