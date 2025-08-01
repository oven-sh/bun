import { bench, run } from "../runner.mjs";
// This is a benchmark of the performance impact of using private properties.

bench("Polyfillprivate", () => {
  "use strict";
  var __classPrivateFieldGet =
    (this && this.__classPrivateFieldGet) ||
    function (receiver, state, kind, f) {
      if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
      if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
        throw new TypeError("Cannot read private member from an object whose class did not declare it");
      return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
    };
  var __classPrivateFieldSet =
    (this && this.__classPrivateFieldSet) ||
    function (receiver, state, value, kind, f) {
      if (kind === "m") throw new TypeError("Private method is not writable");
      if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
      if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
        throw new TypeError("Cannot write private member to an object whose class did not declare it");
      return kind === "a" ? f.call(receiver, value) : f ? (f.value = value) : state.set(receiver, value), value;
    };
  var _Foo_state, _Foo_inc;
  class Foo {
    constructor() {
      _Foo_state.set(this, 1);
      _Foo_inc.set(this, 13);
    }
    run() {
      let n = 1000000;
      while (n-- > 0) {
        __classPrivateFieldSet(
          this,
          _Foo_state,
          __classPrivateFieldGet(this, _Foo_state, "f") + __classPrivateFieldGet(this, _Foo_inc, "f"),
          "f",
        );
      }
      return n;
    }
  }
  (_Foo_state = new WeakMap()), (_Foo_inc = new WeakMap());
  new Foo().run();
});

bench("NativePrivates", () => {
  class Foo {
    #state = 1;
    #inc = 13;

    run() {
      let n = 1000000;
      while (n-- > 0) {
        this.#state += this.#inc;
      }
      return n;
    }
  }

  new Foo().run();
});

bench("ConventionalPrivates", () => {
  class Foo {
    _state = 1;
    _inc = 13;

    run() {
      let n = 1000000;
      while (n-- > 0) {
        this._state += this._inc;
      }
      return n;
    }
  }

  new Foo().run();
});

const _state = Symbol("state");
const _inc = Symbol("inc");

bench("SymbolPrivates", () => {
  class Foo {
    [_state] = 1;
    [_inc] = 13;

    run() {
      let n = 1000000;
      while (n-- > 0) {
        this[_state] += this[_inc];
      }
      return n;
    }
  }

  new Foo().run();
});

await run();
