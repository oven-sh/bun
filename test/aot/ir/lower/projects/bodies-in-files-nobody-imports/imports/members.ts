import { a } from "./a";
export class C {
  #p = a;
  m() {
    return () => {
      return { b: { c: this.#p } };
    };
  }
  get g() {
    return 1;
  }
  static {
    a;
  }
}
export const after = () => {
  return a;
};
