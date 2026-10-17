import {
  accessorsReadOffReceiversOfManyKinds,
  calledConstructedAndExtended,
  calledOnReceiversOfManyKinds,
  heldAndCalledWithoutTheirHolder,
} from "./generated/builtins-vs-running-bun";
import { generated } from "./generated/run-generated";

generated(
  "built-ins asked of the running bun",
  Object.entries({
    "held and called without their holder": heldAndCalledWithoutTheirHolder,
    "called on receivers of many kinds": calledOnReceiversOfManyKinds,
    "called, constructed and extended": calledConstructedAndExtended,
    "accessors read off receivers of many kinds": accessorsReadOffReceiversOfManyKinds,
  }).map(([name, write]) => ({ name, isAlwaysRun: true, make: () => ({ file: "main.js", text: write() }) })),
);
