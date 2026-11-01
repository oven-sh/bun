import { testCells } from "./harness/cells";
import { call, cells } from "./harness/object-deeds";

const makers = ["literal", "instance", "inherits", "bare", "list", "function"] as const;
// RememberedReadsOutlastWrites, FieldsNeverChange, RemovedFieldsHaveUnknownReaders.
const turned = ["literal3", "instance75", "inherits9"];
testCells("three deeds on an object", makers.flatMap(cells), 4000, "", call, undefined, 60, turned);
