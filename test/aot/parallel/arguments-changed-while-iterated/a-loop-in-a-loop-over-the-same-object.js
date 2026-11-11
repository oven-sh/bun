function twoDeep() {
  const seen = [];
  for (const outer of arguments) {
    for (const inner of arguments) {
      if (outer === "a" && inner === "a") arguments[1] = "Y";
      seen.push(outer + inner);
    }
  }
  return seen.join();
}
console.log(twoDeep("a", "b"));
