// Prints the names of the functions and classes without a name of their own that `accessor` fields hold, beside those that ordinary fields hold.
class Holder {
  accessor open: unknown = () => 1;
  accessor #hidden: unknown = () => 1;
  accessor #hiddenFunction: unknown = function () {};
  accessor #hiddenClass: unknown = class {};
  accessor #named: unknown = function own() {};
  static accessor fixed: unknown = function () {};
  static accessor #fixedHidden: unknown = class {};
  static accessor #fixedArrow: unknown = () => 1;
  // @ts-ignore
  accessor [String("computed")]: unknown = () => 1;
  accessor "quoted name": unknown = () => 1;
  accessor 1: unknown = () => 1;
  field: unknown = () => 1;
  #field: unknown = () => 1;
  names() {
    return [
      this.open,
      this.#hidden,
      this.#hiddenFunction,
      this.#hiddenClass,
      this.#named,
      Holder.fixed,
      Holder.#fixedHidden,
      Holder.#fixedArrow,
      (this as any).computed,
      this["quoted name"],
      this[1],
      this.field,
      this.#field,
    ].map((each: any) => JSON.stringify(each.name));
  }
}
console.log(new Holder().names().join(" "));
const Unnamed = [
  class {
    accessor #hidden: unknown = () => 1;
    static accessor #fixedHidden: unknown = () => 1;
    names() {
      const Made = this.constructor as any;
      return [this.#hidden, Made.fixedHidden()].map((each: any) => JSON.stringify(each.name));
    }
    static fixedHidden() {
      return this.#fixedHidden;
    }
  },
][0];
console.log(new Unnamed().names().join(" "));
export {};
