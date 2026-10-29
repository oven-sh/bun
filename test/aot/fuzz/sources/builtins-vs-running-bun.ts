import {
  accessorsReadOffReceiversOfManyKinds,
  calledConstructedAndExtended,
  calledOnReceiversOfManyKinds,
  heldAndCalledWithoutTheirHolder,
} from "../generators/builtins-vs-running-bun";
import { family } from "../family";

export default family(
  "built-ins asked of the running bun",
  Object.entries({
    "held and called without their holder": heldAndCalledWithoutTheirHolder,
    "called on receivers of many kinds": calledOnReceiversOfManyKinds,
    "called, constructed and extended": calledConstructedAndExtended,
    "accessors read off receivers of many kinds": accessorsReadOffReceiversOfManyKinds,
  }).map(([name, write]) => ({ name, make: () => ({ file: "main.js", text: write() }) })),
);
