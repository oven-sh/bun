import * as v from "valibot";

const LoginSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  password: v.pipe(v.string(), v.minLength(8)),
  remember: v.optional(v.boolean(), false),
  kind: v.picklist(["a", "b"]),
});
type LoginData = v.InferOutput<typeof LoginSchema>;
const data: LoginData = v.parse(LoginSchema, { email: "jane@example.com", password: "12345678", kind: "a" });
console.log(JSON.stringify(data));
const result = v.safeParse(LoginSchema, { email: "nope", password: "1", kind: "c" });
console.log(
  result.success,
  result.issues?.map(issue => `${v.getDotPath(issue)}: ${issue.type}: ${issue.message}`).join("; "),
);
console.log(
  JSON.stringify(v.flatten<typeof LoginSchema>(result.issues!).nested),
  v.is(v.array(v.number()), [1, "2"]),
  v.parse(v.pipe(v.string(), v.transform(Number), v.minValue(2)), "3"),
);
console.log(
  JSON.stringify(
    v.parse(
      v.variant("type", [
        v.object({ type: v.literal("x"), x: v.number() }),
        v.object({ type: v.literal("y"), y: v.string() }),
      ]),
      { type: "y", y: "z" },
    ),
  ),
  await v.parseAsync(
    v.pipeAsync(
      v.string(),
      v.checkAsync(async text => text.length > 1),
    ),
    "ab",
  ),
);
