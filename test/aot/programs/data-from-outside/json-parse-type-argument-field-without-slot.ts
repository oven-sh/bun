// A declared field that gets no slot comes before parsed fields, so a parsed field's number at run time is lower than its position in the type.
type UnusedFirst = { a?: never; b: string; c?: number };
type UnusedBetween = { b: string; a?: never; c?: number; z?: never; d?: boolean };
type UnusedInWideType = {
  a?: never; k0?: number; k1?: number; k2?: number; k3?: number; k4?: number; k5?: number; k6?: number;
  z?: never; k7?: number; k8?: number; k9?: number; k10?: number; k11?: number; k12?: number; k13?: number; k14?: number;
};

function show(label: string, text: string, value: object): void {
  const inLoop: string[] = [];
  for (const key in value) inLoop.push(key);
  console.log(label, text, Object.keys(value).join(), inLoop.join(), JSON.stringify(value));
}

const wideMembers = Array.from({ length: 15 }, (_, index) => '"k' + index + '":' + index);
const wideTexts = [
  "{" + wideMembers.join(",") + "}",
  "{" + wideMembers.slice().reverse().join(",") + "}",
  "{" + wideMembers.slice(7).concat(wideMembers.slice(0, 7)).join(",") + "}",
  "{" + wideMembers[14] + "," + wideMembers[0] + "}",
];

for (let round = 0; round < 3; round++) {
  for (const text of ['{"b":"x"}', '{"c":1,"b":"x"}', '{"b":"x","c":1}', '{"c":1,"o":2,"b":"x"}'])
    show("unused first", text, JSON.parse<UnusedFirst>(text));
  for (const text of ['{"b":"x"}', '{"d":true,"c":1,"b":"x"}', '{"c":1,"d":false,"b":"x"}', '{"d":true,"b":"x"}'])
    show("unused between", text, JSON.parse<UnusedBetween>(text));
  for (const text of wideTexts)
    show("unused in a wide type", text, JSON.parse<UnusedInWideType>(text));
}

const parsed = JSON.parse<UnusedFirst>('{"c":2,"b":"y"}');
console.log(parsed.b, parsed.c);
