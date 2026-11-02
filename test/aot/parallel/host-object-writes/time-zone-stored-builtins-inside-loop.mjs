// A loop reads process.env.TZ and the hour of a date in every turn. In two of the turns a built-in function stores another time zone.
// Env: TZ=Asia/Tokyo
function read() {
  return process.env.TZ;
}
let same = 0;
for (let i = 0; i < 100000; i++) if (read() === "Asia/Tokyo") same++;
console.log(same);

const seen = [];
const date = new Date(0);
for (let i = 0; i < 8; i++) {
  seen.push(read(), process.env.TZ, date.getHours(), new Date(0).getTimezoneOffset(), Object.keys(process.env).includes("TZ"));
  if (i === 3) Object.assign(process.env, { TZ: "Europe/Berlin" });
  if (i === 5) Reflect.set(process.env, "TZ", "America/New_York");
}
console.log(seen.join());
