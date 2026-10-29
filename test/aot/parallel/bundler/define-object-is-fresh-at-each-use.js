// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
// Reference: bun build --compile
console.log(JSON.stringify(CONFIG), CONFIG.a.length, CONFIG === CONFIG, CONFIG.a === CONFIG.a);
CONFIG.a.push(3);
console.log(CONFIG.a.length);
