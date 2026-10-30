// Config is made by nothing but a parse: no literal, no class.
interface Config { host: string; port: number; nested: { depth: number } }
const text = process.argv.length > 99 ? "{}" : '{"host":"a","port":1,"nested":{"depth":2}}';
const config: Config = JSON.parse(text);
let total = 0;
for (let i = 0; i < 1000; i++) total += config.port + config.nested.depth + config.host.length;
console.log(total);
