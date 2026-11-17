import { testCells } from "../../harness/cells";
import { call, cells, helpers } from "../../harness/object-copies";

testCells("every kind of source copied in every way", cells(), 2000, helpers, call);
