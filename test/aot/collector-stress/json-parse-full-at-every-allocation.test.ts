import { learnedTables, narrowRecords } from "./json-parse-programs";
import { collectorStressOn } from "./run-collector-stress";

collectorStressOn("full", 1, [...narrowRecords, ...learnedTables]);
