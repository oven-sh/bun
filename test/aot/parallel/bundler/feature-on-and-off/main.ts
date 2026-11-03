// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Reference: bun build --compile
import { feature } from "bun:bundle";
if (feature("ON")) require("./on");
else require("./missing-1");
if (feature("OFF")) require("./missing-2");
console.log(feature("ON") ? "on" : "off", feature("OFF") ? "on" : "off");
if (!feature("OFF") && feature("ON")) console.log("both");
if (feature("OFF") || feature("ON")) console.log("either");
if ({ on: feature("ON") }.on) console.log("in an object literal");
