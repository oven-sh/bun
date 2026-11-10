class Safe {
  #code;
  #tries = 0;
  static made = 0;
  constructor(code) {
    this.#code = code;
    Safe.made++;
  }
  open(code) {
    this.#tries++;
    return code === this.#code;
  }
  get tries() {
    return this.#tries;
  }
}
const safe = new Safe(42);
console.log(safe.open(1), safe.open(42), safe.tries, Safe.made, Object.keys(safe).length);
