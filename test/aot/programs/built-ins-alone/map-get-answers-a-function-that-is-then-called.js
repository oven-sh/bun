function work(value) {
  return value + 1;
}
console.log(new Map([["work", work]]).get("work")(1.5));
