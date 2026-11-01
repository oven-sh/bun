class C {
  m() {
    return 1;
  }
}
C.prototype.q = {
  toJSON() {
    return "tj";
  },
};
console.log(JSON.stringify([new C()], ["q"]));
