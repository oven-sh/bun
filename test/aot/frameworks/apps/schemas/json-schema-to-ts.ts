import { type FromSchema, asConst, wrapValidatorAsTypeGuard } from "json-schema-to-ts";
import Ajv from "ajv";

const dogSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer" },
    hobbies: { type: "array", items: { type: "string" } },
    favoriteFood: { enum: ["pizza", "taco", "fries"] },
    owner: {
      oneOf: [
        { type: "null" },
        { type: "object", properties: { id: { type: "number" } }, required: ["id"], additionalProperties: false },
      ],
    },
  },
  required: ["name", "age"],
  additionalProperties: false,
} as const;
type Dog = FromSchema<typeof dogSchema>;
const dog: Dog = { name: "Rex", age: 3, hobbies: ["barking"], favoriteFood: "pizza", owner: { id: 1 } };
const ajv = new Ajv();
const validate = wrapValidatorAsTypeGuard((schema, data) => ajv.validate(schema, data));
const unknown: unknown = JSON.parse(JSON.stringify(dog));
if (validate(dogSchema, unknown))
  console.log(unknown.name, unknown.age, unknown.hobbies?.join(), unknown.favoriteFood, unknown.owner?.id);
console.log(validate(dogSchema, { name: 1 }), JSON.stringify(asConst({ type: "string", enum: ["a"] })));
