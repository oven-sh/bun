// A text that holds what its type says is parsed into that type, whatever a literal of the type holds: the log stays empty.
// Flags: --aot-log-type-mismatches
interface Config {
  port: number;
  secure: boolean;
  retries: number;
  host: string;
}
interface Service {
  name: string;
  config: Config;
}
const DEFAULTS: Config = { port: 80, secure: false, retries: 3, host: "localhost" };
const FIRST: Service = { name: "first", config: { port: 80, secure: false, retries: 3, host: "localhost" } };

function readConfig(text: string): Config {
  return JSON.parse(text) as Config;
}
function readList(text: string): Config[] {
  return JSON.parse(text) as Config[];
}
function readService(text: string): Service {
  return JSON.parse(text) as Service;
}
function describe(config: Config): string {
  return `${config.host}:${config.port} ${config.secure} ${config.retries} ${config.port === DEFAULTS.port}`;
}

const later = Date.now() > 0;
const text = `{"port":${later ? 3000 : 80},"secure":${later},"retries":${later ? 5 : 3},"host":"example"}`;
const same = '{"port":80,"secure":false,"retries":3,"host":"localhost"}';

console.log(describe(readConfig(text)));
console.log(describe(readConfig(same)));
for (const each of readList(`[${text},${same},${text}]`)) console.log(describe(each));
const service = readService(`{"name":"second","config":${text}}`);
console.log(service.name, describe(service.config), FIRST.name, describe(FIRST.config));
console.log(describe(DEFAULTS));
