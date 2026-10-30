import defer * as b from "./b.mjs";
console.log("main begins");
console.log(Reflect.ownKeys(b).map(String).join());
