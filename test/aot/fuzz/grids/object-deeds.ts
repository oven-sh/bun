import { testCells } from "../../harness/cells";
import { call, cells } from "../../harness/object-deeds";

const makers = ["literal", "instance", "inherits", "bare", "list", "function"] as const;
testCells("three deeds on an object", makers.flatMap(cells), 4000, "", call);
