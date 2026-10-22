// `as` on an object, `x!`, and data from outside that enters typed variables, parameters and results never throw, as in plain Bun.
interface Config { host: string; port: number; nested?: { deep: boolean } }
const outside: any = JSON.parse('{"host":"h","port":1,"unknown":[1,2]}');
const other: any = JSON.parse('{"something":"else"}');
function takes(config: Config): Config { return config; }
function hostOf(config: Config) { return config.host; }
const cast = outside as Config;
const annotated: Config = outside;
const returned = takes(other);
console.log(cast === outside, annotated === outside, returned === other, hostOf(cast), String(hostOf(other)));
console.log(cast.nested!, other.nested?.deep, Object.keys(takes(outside)).join());
const holder: { config: Config | undefined } = { config: undefined };
holder.config = outside;
console.log(holder.config!.port, holder.config === outside);
class Keeper { kept: Config; constructor(config: Config) { this.kept = config; } }
console.log(new Keeper(outside).kept === outside, new Keeper(other).kept === other);
delete outside.host;
Object.setPrototypeOf(outside, null);
outside.port = "text";
console.log(JSON.stringify(outside), Object.getPrototypeOf(outside));
