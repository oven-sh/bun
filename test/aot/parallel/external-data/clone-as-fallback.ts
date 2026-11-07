type Point = { a: number; b: string };

const show = (object: object) => {
  const keys = Object.keys(object);
  return keys.length + " keys: " + keys.slice(0, 4).join(",") + " ... " + keys.slice(-2).join(",");
};

function parseAndCopy(text: string) {
  const parsed = JSON.parse(text) as Point;
  const copy: Point = { ...parsed, b: "replaced" };
  return [parsed.a, parsed.b, copy.a, copy.b, show(parsed), show(copy), copy === parsed].join(" | ");
}

const manyKeys: Record<string, number> = { a: 1 };
for (let i = 0; i < 5000; i++) manyKeys["key" + i] = i;
const texts = [
  '{"a":1,"b":"plain"}',
  '{"b":"reversed","a":2}',
  '{"0":"zero","a":3,"b":"index key"}',
  '{"a":4,"7":"seven","b":"index key between"}',
  JSON.stringify({ ...manyKeys, b: "5,000 keys" }),
];

for (let round = 0; round < 3; round++) {
  for (const text of texts) console.log(parseAndCopy(text));
}
