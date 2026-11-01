import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/object-copies";

// RemovedFieldsHaveUnknownReaders, WalkedKeysStandInTheFirstOrder, WalkedLiteralsAreAsTheyWereMade.
const turned = ["c858", "c18", "c91"];
testCells("every kind of source copied in every way", cells(), 2000, helpers, call, undefined, 20, turned);
