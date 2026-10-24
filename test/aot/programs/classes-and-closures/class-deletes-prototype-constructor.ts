// A class takes `constructor` off its own prototype in a static block and freezes the prototype, so that no instance hands out the class.
class Sealed {
  readonly #inner: string
  private constructor(inner: string) { this.#inner = inner }
  static of(inner: string): Sealed { return new Sealed(inner) }
  static open(from: unknown): string | null { return typeof from === "object" && from !== null && #inner in from ? from.#inner : null }
  describe() { return "sealed " + this.#inner.length }
  static {
    Reflect.deleteProperty(Sealed.prototype, "constructor")
    Object.freeze(Sealed.prototype)
  }
}
const one = Sealed.of("a")
const handed: unknown = (one as { constructor?: unknown }).constructor
console.log(Object.hasOwn(Sealed.prototype, "constructor"), handed === Sealed, handed === Object, Object.isFrozen(Sealed.prototype), Sealed.open(one), one.describe(), one instanceof Sealed)
