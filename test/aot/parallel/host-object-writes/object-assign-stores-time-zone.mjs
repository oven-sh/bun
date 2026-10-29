// Object.assign stores TZ in process.env, where the host keeps an accessor of its own until the first store.
// Env: TZ=Asia/Tokyo
const form = () => Object.keys(Object.getOwnPropertyDescriptor(process.env, "TZ") ?? {}).join();
console.log(process.env.TZ, form(), new Date(0).getHours());
Object.assign(process.env, { TZ: "UTC" });
console.log("done", process.env.TZ, form(), new Date(0).getHours());
