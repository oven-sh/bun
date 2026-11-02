// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Reference: bun build --compile
import { feature } from "bun:bundle";
function f(feature: (name: string) => boolean) {
  return feature("ON") ? "never" : "called";
}
console.log(
  f(() => false),
  feature("ON") ? "on" : "off",
);
