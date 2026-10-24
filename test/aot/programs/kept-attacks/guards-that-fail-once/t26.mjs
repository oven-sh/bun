// Guards that fail once, one probe of many. It prints what plain Bun prints.
    import { EventEmitter } from "node:events";
    class Source extends EventEmitter {
      constructor() { super(); this.open = true; }
      close() { this.open = false; }
    }
    function Legacy() { this.old = true; }
    Legacy.prototype.run = function () { return 1; };
    class Heir extends Legacy {
      walk() { return 2; }
    }
    class Plain {
      walk() { return 3; }
    }
    const rounds = Number(process.argv[2]);
    function describe(value) {
      return typeof value[Symbol.iterator] + " " + typeof value[Symbol.asyncIterator] + " " + (value[Symbol.toStringTag] ?? "none");
    }
    const values = [new Source(), new Heir(), Plain.prototype, new Plain()];
    const seen = new Set();
    for (let round = 0; round < rounds; round++) seen.add(describe(values[round & 3]));
    console.log([...seen].join(" | "));
    Source.prototype[Symbol.asyncIterator] = function () {};
    Legacy.prototype[Symbol.iterator] = function () {};
    Object.defineProperty(Plain.prototype, Symbol.toStringTag, { get() { return "plain"; } });
    console.log(values.map(describe).join(" | "));
    console.log(values[0].open, values[1].walk() + values[1].run(), values[3].walk(), Object.prototype.toString.call(values[3]));
  