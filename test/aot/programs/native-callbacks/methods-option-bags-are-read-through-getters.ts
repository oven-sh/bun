// Methods found through instances: native constructors read their options from a class instance through accessors of its prototype: the cause of an Error, the flags of an event, the options of a stream strategy and of a TextDecoder.
let total = 0;

class Options {
  get cause(): number {
    total += 1;
    return 5;
  }
  get detail(): string {
    total += 100;
    return "detail";
  }
  get bubbles(): boolean {
    total += 10000;
    return true;
  }
  get fatal(): number {
    total += 1000000;
    return 1;
  }
  get highWaterMark(): { valueOf(): number } {
    total += 100000000;
    return { valueOf: () => 3 };
  }
}

const options: any = new Options();
const results: unknown[] = [
  new Error("e", options).cause,
  new CustomEvent("x", options).detail,
  new Event("x", options).bubbles,
  new TextDecoder("utf-8", options).fatal,
  new CountQueuingStrategy(options).highWaterMark,
  new AggregateError([], "a", options).cause,
];
console.log(total, results.map(one => typeof one + ":" + String(one)).join());
