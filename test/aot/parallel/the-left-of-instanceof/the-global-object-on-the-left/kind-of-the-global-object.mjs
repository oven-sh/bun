export class Kind {
  static [Symbol.hasInstance](value) { return typeof value.structuredClone === "function" && typeof value.Bun.inspect === "function"; }
}
