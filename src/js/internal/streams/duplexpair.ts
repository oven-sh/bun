"use strict";

const Duplex = require("internal/streams/duplex");

const kCallback = Symbol("Callback");
const kInitOtherSide = Symbol("InitOtherSide");

class DuplexSide extends Duplex {
  // Type the private field to be either null or DuplexSide
  #otherSide: DuplexSide | null = null;
  [kCallback]: (() => void) | null = null;

  constructor(options) {
    super(options);
    this.#otherSide = null;
  }

  [kInitOtherSide](otherSide: DuplexSide) {
    // Ensure this can only be set once, to enforce encapsulation.
    if (this.#otherSide === null) {
      this.#otherSide = otherSide;
    } else {
      $assert(this.#otherSide === null);
    }
  }

  _read() {
    const callback = this[kCallback];
    if (callback) {
      this[kCallback] = null;
      callback();
    }
  }

  _write(chunk, encoding, callback) {
    $assert(this.#otherSide !== null);
    $assert(this.#otherSide[kCallback] === null);
    if (chunk.length === 0) {
      process.nextTick(callback);
    } else {
      // Assert that #otherSide is not null before accessing its methods
      // TypeScript can't see through the $assert call above
      const otherSide = this.#otherSide as DuplexSide;
      otherSide.push(chunk);
      otherSide[kCallback] = callback;
    }
  }

  _final(callback) {
    // Assert that #otherSide is not null before accessing its methods
    const otherSide = this.#otherSide as DuplexSide;
    otherSide.on("end", callback);
    otherSide.push(null);
  }
}

function duplexPair(options) {
  const side0 = new DuplexSide(options);
  const side1 = new DuplexSide(options);
  side0[kInitOtherSide](side1);
  side1[kInitOtherSide](side0);
  return [side0, side1];
}

export default duplexPair;
