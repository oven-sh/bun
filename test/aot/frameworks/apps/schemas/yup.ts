import { type InferType, ValidationError, array, date, number, object, string } from "yup";

const userSchema = object({
  name: string().required(),
  age: number().required().positive().integer(),
  email: string().email(),
  website: string().url().nullable(),
  createdOn: date().default(() => new Date(0)),
  tags: array().of(string().required()).min(1),
});
type User = InferType<typeof userSchema>;
const user: User = await userSchema.validate({ name: "jimmy", age: "24", tags: ["a"] });
console.log(JSON.stringify(user), typeof user.age);
try {
  await userSchema.validate({ age: -1.5, email: "nope", tags: [] }, { abortEarly: false });
} catch (error) {
  console.log(error instanceof ValidationError, (error as ValidationError).errors.join(" | "));
}
console.log(
  JSON.stringify(userSchema.cast({ name: 1, age: "2", createdOn: "2020-01-01T00:00:00.000Z" })),
  userSchema.isValidSync({ name: "a", age: 1, tags: ["x"] }),
  userSchema.describe().fields.age.type,
);
