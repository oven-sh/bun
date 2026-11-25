function* count() {
  yield 1;
  yield 2;
}
console.log(new Set(count()).size, Array.from(count()).join(), Math.max(...count()), Object.fromEntries([["a", 1]].values()).a);
