// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Reference: bun build --compile
function f(FLAG) {
  return FLAG ? "parameter" : "never";
}
console.log(f(true));
{
  const FLAG = 1;
  console.log(FLAG);
}
console.log(FLAG);
if (FLAG) require("./missing");
