console.log(((texts: any, ...values: any) => Reflect.ownKeys(Object(texts)).length + "/" + values.length)`x${1}y`);
console.log(((texts: any, ...values: any) => Object.getOwnPropertyNames(Object(texts)).join() + "/" + values.length)`x${1}y`);
console.log(((texts: any, ...values: any) => [...texts].length + "/" + texts.indexOf("y") + "/" + texts.includes("x") + "/" + texts.join("+") + "/" + values.length)`x${1}y`);
console.log(((texts: any, ...values: any) => String(texts?.constructor?.name) + "/" + Object.isFrozen(texts) + "/" + values.length)`x${1}y`);
