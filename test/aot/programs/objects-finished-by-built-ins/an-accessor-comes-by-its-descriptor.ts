interface Counter {
  name: string;
  step: number;
  label(): string;
}
let reads = 0;
const definition = {
  get name() {
    reads++;
    return "n" + reads;
  },
  step: 2,
};
function build(): Counter {
  return Object.defineProperties({ label: () => "counter" }, Object.getOwnPropertyDescriptors(definition)) as unknown as Counter;
}
function describe(counter: Counter) {
  return counter.name + ":" + counter.step + ":" + counter.label();
}
const counter = build();
console.log(describe(counter), describe(counter), reads);
console.log(typeof Object.getOwnPropertyDescriptor(counter, "name")!.get, Object.getOwnPropertyDescriptor(counter, "step")!.value);
let failure = "none";
try {
  "use strict";
  (function () {
    "use strict";
    counter.name = "stored";
  })();
} catch (error) {
  failure = (error as Error).constructor.name;
}
console.log(failure, counter.name, reads);
