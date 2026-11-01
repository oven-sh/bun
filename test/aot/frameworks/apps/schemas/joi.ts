import Joi from "joi";

const schema = Joi.object({
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().pattern(new RegExp("^[a-zA-Z0-9]{3,30}$")),
  repeat_password: Joi.ref("password"),
  access_token: [Joi.string(), Joi.number()],
  birth_year: Joi.number().integer().min(1900).max(2013),
  email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ["com", "net"] } }),
})
  .with("username", "birth_year")
  .xor("password", "access_token")
  .with("password", "repeat_password");
console.log(JSON.stringify(schema.validate({ username: "abc", birth_year: 1994, access_token: 1 })));
const { error } = schema.validate({ username: "a!", birth_year: 1800, email: "a@b.org" }, { abortEarly: false });
console.log(error?.name, error?.details.map(detail => `${detail.path.join(".")}: ${detail.type}`).join("; "));
try {
  await schema.validateAsync({ username: "abc", birth_year: 1994 });
} catch (failure) {
  console.log(Joi.isError(failure), (failure as Error).message);
}
console.log(
  Joi.attempt("5", Joi.number()),
  JSON.stringify(Joi.array().items(Joi.string().uppercase()).validate(["a"]).value),
  Joi.date().iso().validate("2020-01-01").value.toISOString(),
);
