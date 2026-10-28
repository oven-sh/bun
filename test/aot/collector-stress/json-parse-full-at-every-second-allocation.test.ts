import { learnedTables, manyUndeclaredKeys, narrowRecords } from "./json-parse-programs";
import { collectorStressOn } from "./run-collector-stress";

collectorStressOn("full", 2, [...narrowRecords, ...learnedTables, ...manyUndeclaredKeys]);
