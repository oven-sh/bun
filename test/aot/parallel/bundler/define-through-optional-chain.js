// A path that --define names is replaced behind `?.` as behind a dot. The link no longer asks whether its object is there, and what stands behind the path reads the value.
// Flags: --define=process.env.NODE_ENV="production" --define=absent.level=3 --define=process.env.ALIAS=holder.member
// Env: NODE_ENV=from-env
// Reference: bun build --compile
globalThis.holder = { member: () => "called" };
console.log(process?.env.NODE_ENV, process.env?.NODE_ENV, process?.env?.NODE_ENV, process?.["env"]?.["NODE_ENV"]);
console.log(process?.env.NODE_ENV.length, process.env?.NODE_ENV?.toUpperCase(), process?.env?.NODE_ENV[0]);
console.log(absent?.level, absent?.["level"], typeof absent?.level, absent?.level.toFixed(1));
console.log(typeof process?.env.ALIAS, process.env?.ALIAS(), process?.env?.ALIAS?.(), process?.env.ALIAS.name);
process.env.NODE_ENV = "assigned";
const key = "NODE_ENV";
console.log(process.env[key], process.env?.[key], process.env.NODE_ENV, process?.env.OTHER);
