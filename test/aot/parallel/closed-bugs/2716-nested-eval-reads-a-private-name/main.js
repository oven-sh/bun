class C {
  #p = 1;
  m() {
    return eval('eval("this.#p")');
  }
}
console.log(new C().m());
