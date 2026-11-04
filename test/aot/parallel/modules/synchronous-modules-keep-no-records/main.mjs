// A chain and a fan of synchronous modules run in order, and keep no module records.
import { heapStats } from "bun:jsc";
import { orderSum } from "./log.mjs";
import "./chain-0.mjs";
import "./fan.mjs";
console.log(orderSum);
console.log((heapStats().objectTypeCounts.AOTModuleRecord ?? 0) <= 1);
