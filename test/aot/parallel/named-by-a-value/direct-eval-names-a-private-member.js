class Safe {
  #secret() { return "secret"; }
  get #word() { return "word"; }
  static #make() { return "made"; }
  open(code) { return eval(code); }
  static build(code) { return eval(code); }
}
console.log(new Safe().open("this.#secret()"), new Safe().open("this.#word"), Safe.build("Safe.#make()"));
