class Holder {
  #api = Bun;
  run() {
    return this.#api.escapeHTML("<a>");
  }
}
console.log(new Holder().run());
