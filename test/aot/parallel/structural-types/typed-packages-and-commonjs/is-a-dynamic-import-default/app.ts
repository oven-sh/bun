import { callX } from "default";
console.log(callX(), Object.keys(await import("dep")).join());
