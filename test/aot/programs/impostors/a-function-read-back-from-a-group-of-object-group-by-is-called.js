function half(n) {
  return n / 2;
}
console.log("direct", half(4));
console.log("through the group", Object.groupBy([half], () => "group").group[0](3));
