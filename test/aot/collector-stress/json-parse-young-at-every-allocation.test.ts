import { learnedTables, manyUndeclaredKeys, narrowRecords, wideRecords, widestRecords } from "./json-parse-programs";
import { collectorStressOn } from "./run-collector-stress";

collectorStressOn("young", 1, [
  ...narrowRecords,
  ...wideRecords,
  ...widestRecords,
  ...learnedTables,
  ...manyUndeclaredKeys,
]);
