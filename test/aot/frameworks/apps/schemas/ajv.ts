import Ajv, { type JSONSchemaType } from "ajv";
import addFormats from "ajv-formats";

interface MyData {
  foo: number;
  bar?: string;
  list: string[];
  mail: string;
}
const schema: JSONSchemaType<MyData> = {
  type: "object",
  properties: {
    foo: { type: "integer", minimum: 1 },
    bar: { type: "string", nullable: true },
    list: { type: "array", items: { type: "string" }, uniqueItems: true },
    mail: { type: "string", format: "email" },
  },
  required: ["foo", "list", "mail"],
  additionalProperties: false,
};
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const data: unknown = { foo: 1, bar: "abc", list: ["a"], mail: "a@example.com" };
if (validate(data)) console.log(data.foo, data.bar, data.list.length);
console.log(
  validate({ foo: 0, list: ["a", "a"], mail: "nope", more: 1 }),
  validate.errors?.map(error => `${error.instancePath || "/"} ${error.keyword}`).join("; "),
  ajv.errorsText(validate.errors).length > 0,
);
console.log(
  ajv.validate({ type: "array", items: [{ type: "number" }], minItems: 1, additionalItems: false }, [1]),
  ajv.validate({ $ref: "#/$defs/a", $defs: { a: { enum: [1, 2] } } }, 3),
  typeof validate.schema,
);
