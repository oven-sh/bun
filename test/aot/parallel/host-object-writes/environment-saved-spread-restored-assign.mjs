// A spread takes every variable out of process.env, TZ among them, and Object.assign stores them back.
// Env: TZ=Asia/Tokyo
const form = () => Object.keys(Object.getOwnPropertyDescriptor(process.env, "TZ") ?? {}).join();
const saved = { ...process.env };
console.log(saved.TZ, form());
process.env.ADDED_BY_THE_PROGRAM = "1";
Object.assign(process.env, saved);
console.log("done", process.env.TZ, form(), process.env.ADDED_BY_THE_PROGRAM, new Date(0).getHours());

const { TZ, ...rest } = process.env;
Object.assign(process.env, rest);
console.log(TZ, process.env.TZ, "TZ" in rest);
