// A constant whose initializer is folded is printed in the place of its only use, and an error quotes that: nested conditions over named texts, and comma expressions.
const isDev = false;
const isProd = true;
const devUrl = "http://localhost";
const prodUrl = "https://example.com";
const quote = make => {
  try {
    make();
  } catch (error) {
    console.log(error.message);
  }
};
const sameAtBothEnds = isDev ? devUrl : isDev ? prodUrl : devUrl;
quote(() => null[String(sameAtBothEnds)]);
const sameInFront = isDev ? devUrl : isProd ? devUrl : prodUrl;
quote(() => null[String(sameInFront)]);
const allApart = isDev ? "a" : isDev ? prodUrl : devUrl;
quote(() => null[String(allApart)]);
const nestedInTheFirstArm = isProd ? (isDev ? prodUrl : devUrl) : prodUrl;
quote(() => null[String(nestedInTheFirstArm)]);
const threeDeep = isDev ? devUrl : isDev ? prodUrl : isDev ? prodUrl : devUrl;
quote(() => null[String(threeDeep)]);
const one = isDev ? devUrl : prodUrl;
quote(() => null[String(one)]);
const comma = (isDev, devUrl);
quote(() => null[String(comma)]);
const commaOfThree = (isDev, isProd, prodUrl);
quote(() => null[String(commaOfThree)]);
const commaInACondition = isProd ? (isDev, devUrl) : prodUrl;
quote(() => null[String(commaInACondition)]);
const inBrackets = (devUrl);
quote(() => null[String(inBrackets)]);
const numbers = isDev ? 1 : isDev ? 2 : 3;
quote(() => null[numbers]);
function inAFunction() {
  const flag = false;
  const first = "first";
  const second = "second";
  const chosen = flag ? first : flag ? second : first;
  return null[String(chosen)];
}
quote(inAFunction);
const readAtTheTopLevel = (isDev, devUrl);
try {
  null[String(readAtTheTopLevel)];
} catch (error) {
  console.log(error.message);
}
const nestedAtTheTopLevel = isDev ? devUrl : isDev ? prodUrl : devUrl;
try {
  null[String(nestedAtTheTopLevel)];
} catch (error) {
  console.log(error.message);
}
