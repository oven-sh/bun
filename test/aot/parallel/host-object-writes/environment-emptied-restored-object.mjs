// Every variable is deleted from process.env, by the operator and by Reflect.deleteProperty in turn, and Object.assign stores them back.
// Env: TZ=Asia/Tokyo
const saved = { ...process.env };
process.env.ADDED_BY_THE_PROGRAM = "1";
let turn = 0;
for (const key of Object.keys(process.env)) {
  if (turn++ % 2) delete process.env[key];
  else Reflect.deleteProperty(process.env, key);
}
console.log(
  Reflect.deleteProperty(process.env, "TZ"),
  Reflect.deleteProperty(process.env, "NODE_TLS_REJECT_UNAUTHORIZED"),
  Reflect.deleteProperty(process.env, "BUN_CONFIG_VERBOSE_FETCH"),
);
console.log(Object.keys(process.env).length, process.env.TZ, "TZ" in process.env);
Object.assign(process.env, saved);
console.log(
  process.env.TZ,
  process.env.ADDED_BY_THE_PROGRAM,
  Object.keys(process.env).length === Object.keys(saved).length,
  new Date(0).getHours(),
);
