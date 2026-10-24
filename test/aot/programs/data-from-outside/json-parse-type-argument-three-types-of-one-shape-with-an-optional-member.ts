// Three types of one shape, each with a required member and an optional member of its own type, are the type argument of JSON.parse. The texts have the optional member or not, the keys in the
// declared order or another one, and keys that no type declares in front, between and behind. The order of the keys of what comes back is that of the text. The output is that of plain Bun.
interface First {
  name: string;
  inner?: First;
}
interface Second {
  name: string;
  inner?: Second;
}
interface Third {
  name: string;
  inner?: Third;
}

const texts = [
  '{"name":"a"}',
  '{"name":"b","inner":{"name":"c"}}',
  '{"inner":{"name":"d"},"name":"e"}',
  '{"extra":1,"name":"f","more":[2]}',
  '{"inner":{"name":"g","z":0},"between":null,"name":"h"}',
  '{"name":"i","inner":{"inner":{"name":"j"},"name":"k"},"last":{"name":"l"}}',
];
for (let round = 0; round < 2; round++) {
  for (const text of texts) {
    const first = JSON.parse<First>(text);
    const second = JSON.parse<Second>(text);
    const third = JSON.parse<Third>(text);
    console.log(JSON.stringify(first), Object.keys(second).join(), third.name + (third.inner ? third.inner.name : "-"));
  }
}
