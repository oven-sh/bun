import { Buffer } from "buffer";

globalThis.Buffer ||= Buffer;

if (!("URL" in globalThis)) {
  class Outdated extends Error {
    constructor(message) {
      super(message);
      this.name = "Outdated";
    }
  }

  throw new Outdated(
    "Missing \"URL\", please run 'bun upgrade' to update to the latest version of Bun (added in v0.0.74)"
  );
}
