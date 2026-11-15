import "./plain.cjs";
import "./other.cjs";
import real from "./real.cjs";
console.log("main", real.load().map(it => typeof it).join());
