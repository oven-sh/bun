// A list of programs from ../generators/builtins-vs-running-bun.ts, which describes them.
import {
  accessorsReadOffReceiversOfManyKinds,
  calledConstructedAndExtended,
  calledOnReceiversOfManyKinds,
  heldAndCalledWithoutTheirHolder,
} from "../generators/builtins-vs-running-bun";
import { family } from "../family";

export default family(
  "builtins vs running bun",
  Object.entries({
    "held and called without their holder": heldAndCalledWithoutTheirHolder,
    "called on receivers of many kinds": calledOnReceiversOfManyKinds,
    "called, constructed and extended": calledConstructedAndExtended,
    "accessors read off receivers of many kinds": accessorsReadOffReceiversOfManyKinds,
  }).map(([name, write]) => ({ name, make: () => ({ file: "main.js", text: write() }) })),
);
