// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Env: NODE_ENV=from-env
// Env: ALIAS=from-env
// Reference: bun build --compile
globalThis.holder = { member: 1 };
console.log(delete process.env.NODE_ENV, "NODE_ENV" in process.env);
console.log(delete process.env.ALIAS, "ALIAS" in process.env, "member" in holder);
