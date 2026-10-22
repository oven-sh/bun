class Words extends Array {
  join() {
    console.log("join", arguments.length);
    return "joined";
  }
}
console.log(new Words("a", "b").toString(), String(new Words("a", "b")), `${new Words("a", "b")}`);
