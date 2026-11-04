// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Reference: bun build --compile
if (process.env.NODE_ENV === "production") require("./prod");
else require("./missing-dev");
console.log(process.env.NODE_ENV !== "production" ? require("./missing-dev-2") : "prod arm");
console.log(process.env.NODE_ENV, typeof process.env.NODE_ENV);
