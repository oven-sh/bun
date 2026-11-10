function add(more) {
  return this.n + more;
}
add.kept = Function.prototype.call;
console.log(add.kept({ n: 1 }, 2));
