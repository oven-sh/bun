function losesOne() {
  const seen = [];
  for (const value of arguments) {
    delete arguments[1];
    seen.push(String(value));
  }
  return seen.join();
}
console.log(losesOne("a", "b", "c"));
