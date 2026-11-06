export class Hidden {
  accessor #value = 3;
  double() {
    this.#value *= 2;
    return this.#value;
  }
}
