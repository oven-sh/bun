// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Reference: bun build --compile
FLAG && require("./missing-1");
LEVEL > 2 || require("./missing-2");
NOTHING ?? console.log("nullish");
ABSENT ?? console.log("nullish too");
LEVEL ?? require("./missing-3");
console.log(FLAG, LEVEL + 1, NOTHING, ABSENT, typeof FLAG, typeof LEVEL, typeof NOTHING, typeof ABSENT);
