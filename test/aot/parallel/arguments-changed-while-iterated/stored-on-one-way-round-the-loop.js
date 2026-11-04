function storesOnOneWay() {
  const seen = [];
  for (const value of arguments) {
    if (value === "a") {
      arguments[1] = "Y";
      continue;
    }
    if (value === "Y") {
      try { arguments.length = 2; throw new Error("stop"); } catch { seen.push("caught"); }
    }
    seen.push(value);
  }
  return seen.join();
}
console.log(storesOnOneWay("a", "b", "c"));
