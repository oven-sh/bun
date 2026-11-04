// A text names one member twice and is parsed by a written type: the later value stands, at the place of the first among the keys, whatever the kinds of the two values.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make
type Config = { port: number; host: string };
function load(text: string) { return JSON.parse(text) as Config; }
function show(c: Config) { return JSON.stringify(c) + " " + Object.keys(c).join() + " " + typeof c.port + " " + typeof c.host; }
const texts = [
  '{"port":1,"port":2,"host":"a"}',
  '{"port":1,"host":"a","port":2}',
  '{"port":"text","port":3,"host":"a"}',
  '{"port":4,"host":"a","port":"text"}',
  '{"host":"a","port":5,"host":"b","port":6}',
  '{"port":7,"host":"a","host":null}',
  '{"port":8,"more":1,"host":"a","more":2}',
  '{"port":{"port":9},"port":[10],"host":"a"}',
];
for (let round = 0; round < 3; round++) {
  for (const text of texts) console.log(show(load(text)));
}
