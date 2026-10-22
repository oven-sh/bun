import { getSystemErrorMap, getSystemErrorName } from "node:util";
console.log(getSystemErrorName(-2), getSystemErrorMap() instanceof Map, getSystemErrorMap().get(-2)[0]);
