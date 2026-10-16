// A call of a public package
interface Address {
  city: string;
  zip: string;
}
interface User {
  id: number;
  name: string;
  kind: string;
  ok: boolean;
  score: number;
  address: Address;
}
const user: User = { id: 1, name: "name 1", kind: "k", ok: true, score: 1.5, address: { city: "c", zip: "z" } };

const text = { type: "string" },
  number = { type: "number" };
const schema = {
  type: "object",
  required: ["id", "name", "kind", "ok", "score", "address"],
  properties: {
    id: number,
    name: text,
    kind: text,
    ok: { type: "boolean" },
    score: number,
    address: { type: "object", required: ["city", "zip"], properties: { city: text, zip: text } },
  },
};

function repeated(call: () => number) {
  return (turns: number) => {
    let sum = 0;
    for (let i = 0; i < turns; i++) sum += call();
    return sum;
  };
}

const cases: Record<string, () => (turns: number) => number> = {
  "fast-json-stringify: a serializer made of a schema": () => {
    const stringify = require("fast-json-stringify")(schema);
    return repeated(() => stringify(user).length);
  },
  "ajv: a validator made of a schema": () => {
    const Ajv = require("ajv");
    const validate = new Ajv().compile(schema);
    return repeated(() => +validate(user));
  },
  "zod: parse": () => {
    const { z } = require("zod");
    const parser = z.object({
      id: z.number(),
      name: z.string(),
      kind: z.string(),
      ok: z.boolean(),
      score: z.number(),
      address: z.object({ city: z.string(), zip: z.string() }),
    });
    return repeated(() => parser.parse(user).id);
  },
};

const name = process.argv[2];
if (name === "names") console.log(Object.keys(cases).join("\n"));
else {
  const turn = cases[name]();
  let last: unknown;
  for (const turns of process.argv.slice(3)) {
    last = turn(Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
}
