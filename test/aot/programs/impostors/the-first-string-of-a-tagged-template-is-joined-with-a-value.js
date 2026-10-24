function tag(strings, value) {
  return strings[0] + value;
}

console.log("gives " + tag`-${5}`);
console.log("gives " + tag`${6}`);
