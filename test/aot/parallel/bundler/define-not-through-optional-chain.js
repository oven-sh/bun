// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Env: NODE_ENV=from-env
// Reference: bun build --compile
console.log(process?.env.NODE_ENV, process.env?.NODE_ENV);
process.env.NODE_ENV = "assigned";
const key = "NODE_ENV";
console.log(process.env[key], process.env.NODE_ENV);
