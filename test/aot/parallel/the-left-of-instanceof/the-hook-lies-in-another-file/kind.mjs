export class Kind {
  static [Symbol.hasInstance](value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; }
}
