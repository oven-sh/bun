// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Reference: bun build --compile
function f(text) {
  eval(text);
  return FLAG ? "never" : process.env.NODE_ENV;
}
console.log(f(""));
eval("");
console.log(FLAG, process.env.NODE_ENV, typeof require);
