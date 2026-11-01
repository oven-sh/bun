import { testCells } from "./harness/cells";
import { call, cells, helpers } from "./harness/iterator-uses";

testCells("every source taken by every construct that iterates", cells(), 1000, helpers, call);
