// Texts leave out members that the written type requires, and optional ones: what is left out is not there, for a read, for `in`, for Object.keys and for a later store.
// Under: --aot-testing=CheckProofsAtRunTime: a field that is filled in every object of its layout
type Config = { port: number; host: string; tags?: string[]; deep: { on: boolean } };
function load(text: string) { return JSON.parse(text) as Config; }
function show(c: Config) {
  return [Object.keys(c).join(), "port" in c, "host" in c, "tags" in c, "deep" in c, String(c.port), String(c.host), String(c.tags), c.deep ? String(c.deep.on) : "none"].join(" | ");
}
const texts = [
  '{"port":1,"host":"a","deep":{"on":true}}',
  '{"port":1,"host":"a","tags":["t"],"deep":{"on":false}}',
  '{"host":"a","deep":{"on":true}}',
  '{"port":1,"deep":{"on":true}}',
  '{"port":1,"host":"a"}',
  '{"port":1,"host":"a","deep":{}}',
  '{"tags":[]}',
  '{}',
];
for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    const config = load(text);
    console.log(show(config));
    config.port = round;
    config.host = "late";
    console.log(show(config));
  }
}
