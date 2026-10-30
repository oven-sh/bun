import { drainMicrotasks } from "bun:jsc";
console.log("drain begins");
drainMicrotasks();
console.log("drain ends");
