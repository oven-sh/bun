"use strict";
class Base {
  constructor(label) {
    this.label = label;
  }
}
class Judged {
  static [Symbol.hasInstance](value) {
    return value === "judged" || (typeof value === "object" && value !== null && value.label === "judged");
  }
}
Object.defineProperty(exports, "Base", { enumerable: true, get: () => Base });
Object.defineProperty(exports, "Judged", { enumerable: true, get: () => Judged });
