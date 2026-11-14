import { z } from "zod";

const User = z.object({
  username: z.string().min(3),
  email: z.email(),
  age: z.number().int().positive().optional(),
  role: z.enum(["admin", "user"]).default("user"),
  tags: z.array(z.string()).max(3),
  address: z.object({ city: z.string() }).partial(),
});
type User = z.infer<typeof User>;
const parsed: User = User.parse({ username: "ada", email: "ada@example.com", tags: ["a"], address: {} });
console.log(JSON.stringify(parsed));
const result = User.safeParse({
  username: "a",
  email: "nope",
  age: -1.5,
  tags: ["a", "b", "c", "d"],
  address: { city: 1 },
});
if (!result.success)
  console.log(
    result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.code}`).join("; "),
    JSON.stringify(z.flattenError(result.error).fieldErrors.username),
    z.prettifyError(result.error).split("\n").length,
  );
const Shape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), radius: z.number() }),
  z.object({ kind: z.literal("square"), side: z.number() }),
]);
console.log(JSON.stringify(Shape.parse({ kind: "square", side: 2 })), Shape.safeParse({ kind: "line" }).success);
console.log(
  z
    .string()
    .transform(text => text.length)
    .pipe(z.number().min(2))
    .parse("abc"),
  z.coerce.date().parse("2020-01-01").toISOString(),
  await z
    .string()
    .refine(async text => text === "ok")
    .safeParseAsync("no")
    .then(each => each.success),
);
console.log(
  JSON.stringify(z.record(z.string(), z.number()).parse({ a: 1 })),
  z.tuple([z.string(), z.number()]).parse(["a", 1]).length,
  User.pick({ email: true }).keyof().options.join(),
  z.union([z.string(), z.null()]).nullable().parse(null),
);
console.log(
  JSON.stringify(z.toJSONSchema(User.pick({ username: true, role: true }))),
  z.templateLiteral(["id-", z.number()]).safeParse("id-5").success,
  z.stringbool().parse("yes"),
);
