import { isLeft, isRight } from "fp-ts/Either";
import { pipe } from "fp-ts/function";
import * as O from "fp-ts/Option";
import * as t from "io-ts";
import { PathReporter } from "io-ts/PathReporter";

const User = t.intersection([
  t.type({ userId: t.number, name: t.string, kind: t.union([t.literal("a"), t.literal("b")]) }),
  t.partial({ tags: t.array(t.string) }),
]);
type User = t.TypeOf<typeof User>;
const good = User.decode({ userId: 1, name: "Giulio", kind: "a", tags: ["x"] });
if (isRight(good)) {
  const user: User = good.right;
  console.log(JSON.stringify(user));
}
const bad = User.decode({ userId: "1", kind: "c", tags: [1] });
console.log(
  isLeft(bad),
  PathReporter.report(bad).length,
  PathReporter.report(bad)[0],
  PathReporter.report(good).join(),
);
console.log(
  User.is({ userId: 1, name: "a", kind: "b" }),
  User.name.length > 0,
  pipe(
    O.some(2),
    O.map(n => n * 2),
    O.getOrElse(() => 0),
  ),
  pipe(
    O.none as O.Option<number>,
    O.getOrElse(() => -1),
  ),
);
