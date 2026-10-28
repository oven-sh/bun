// JSON.parse into a declared type, and JSON.stringify back.
interface Config {
  name: string;
  port: number;
  tags: string[];
  nested?: { enabled: boolean };
}
const text = '{"name":"server","port":8080,"tags":["a","b"],"nested":{"enabled":true}}';
const config: Config = JSON.parse(text);
console.log(config.name, config.port + 1, config.tags.length, config.nested?.enabled);
const cast = JSON.parse("[1,2,3]") as number[];
console.log(cast.reduce((a, b) => a + b, 0));
const untyped = JSON.parse('{"a":{"b":[null,1.5,"s"]}}');
console.log(untyped.a.b[1], JSON.stringify(config), JSON.stringify({ a: undefined, b: () => 1, c: [undefined] }));
try {
  JSON.parse("{bad");
} catch (error) {
  console.log((error as Error).name);
}
console.log(JSON.parse("[1,2]", (key, value) => (typeof value === "number" ? value * 2 : value)));
