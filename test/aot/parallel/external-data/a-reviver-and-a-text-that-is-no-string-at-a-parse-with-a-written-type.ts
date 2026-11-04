// JSON.parse with a written type is handed a reviver, what is no function in its place, and in the place of the text an object that converts itself, a number, bytes, null and nothing: each conversion runs once, and the reviver sees every member.
type Config = { port: number; host: string };
let conversions = 0;
const converts = { toString() { conversions++; return '{"port":1,"host":"converted"}'; } };
const convertsToOddText = { toString() { conversions++; return '{"port":"odd","more":[1]}'; } };
function plain(text: unknown) { return JSON.parse(text as string) as Config; }
function revived(text: string, reviver: unknown) { return JSON.parse(text, reviver as (key: string, value: unknown) => unknown) as Config; }
function tell(f: () => unknown) { try { console.log(JSON.stringify(f())); } catch (error) { console.log((error as Error).name); } }
for (let round = 0; round < 3; round++) {
  tell(() => plain('{"port":1,"host":"a"}'));
  tell(() => plain(converts));
  tell(() => plain(convertsToOddText));
  tell(() => plain(new String('{"port":2,"host":"boxed"}')));
  tell(() => plain(7));
  tell(() => plain(null));
  tell(() => plain(true));
  tell(() => plain(undefined));
  tell(() => plain(new Uint8Array([123, 125])));
  tell(() => plain(['{"port":3,"host":"list"}']));
  tell(() => plain(Symbol("text")));
  const seen: string[] = [];
  tell(() => revived('{"port":4,"host":"a","more":{"x":1}}', function (this: unknown, key: string, value: unknown) { seen.push(key); return typeof value === "number" ? value * 2 : value; }));
  console.log(seen.join());
  tell(() => revived('{"port":5,"host":"a"}', (key: string, value: unknown) => key === "host" ? undefined : value));
  tell(() => revived('{"port":6,"host":"a"}', undefined));
  tell(() => revived('{"port":7,"host":"a"}', null));
  tell(() => revived('{"port":8,"host":"a"}', 1));
  tell(() => revived('{"port":9,"host":"a"}', {}));
  tell(() => revived('{"port":10,"host":"a"}', ["port"]));
}
console.log(conversions);
