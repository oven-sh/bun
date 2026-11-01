import { testCells } from "./harness/cells";
import { call, cells, helpers, makers, walksOf } from "./harness/list-deeds";

const kinds = Object.keys(makers) as (keyof typeof makers)[];
testCells("two deeds on a list", kinds.flatMap(cells), 3300, helpers, call, undefined, 100);
// CallsGiveNoArrayOtherStorage, ListsWrittenInLoopsAreLeftAlone, ProofsOutlastWritesToTheirSubject, RememberedReadsOutlastWrites.
const turned = ["w8n4", "w2n1130", "w0n1130", "w0n1096"];
testCells(
  "a walk over a list and a deed in its second turn",
  kinds.flatMap(walksOf),
  2000,
  helpers,
  call,
  undefined,
  20,
  turned,
);
