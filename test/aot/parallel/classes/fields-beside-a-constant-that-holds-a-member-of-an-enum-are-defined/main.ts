// @ts-nocheck
// Where fields are assigned ("useDefineForClassFields": false), a key in brackets that is a member of an enum is computed for `bun run`, and so is a constant that holds one: the class defines its fields.
// That goes for a constant whose member stands behind what `bun run` leaves out: a list in front of a comma, a list that picks. And for one whose member is picked by what `bun run` alone works out: a sum, a length.
// The constants stand at the head of the file, where `bun run` writes them in place.
enum Kind {
  User = "kind",
  Count = 7,
}
// prettier-ignore
const WRITTEN = "kind", BEHIND_A_TEXT = ([], "kind"), PLAIN = Kind.User, COMMA = ([], Kind.User), NUMBER = ([], Kind.Count), PICKED = [...[1]] ? Kind.User : "z", VOIDED = (void 0, Kind.User), SUM = Kind.Count + 1,
  TEXT_BY_A_SUM = 1 + 1 === 2 ? "kind" : "z", BY_A_SUM = 1 + 1 === 2 ? Kind.User : "z", BY_A_LENGTH = "abc".length ? Kind.Count : 0, AND = "abc".length && Kind.User, OR = ("abc".length - 3) || Kind.User;
const log: string[] = [];
class Model {}
for (const name of ["y", "kind", "7", "8"]) {
  Object.defineProperty(Model.prototype, name, {
    set(value) {
      log.push(name + "<" + value);
    },
    configurable: true,
  });
}
const tell = (label: string, made: object) =>
  console.log(label, log.splice(0).join() || "none", Object.keys(made).join() || "no keys", "bare" in made);
// prettier-ignore
{
  tell("a written constant is assigned", new (class extends Model { [WRITTEN] = 1; y = 2; bare!: string; })());
  tell("so is one behind a list and a comma", new (class extends Model { [BEHIND_A_TEXT] = 1; y = 2; bare!: string; })());
  tell("so is a sum over a member", new (class extends Model { [SUM] = 1; y = 2; bare!: string; })());
  tell("a member", new (class extends Model { [PLAIN] = 1; y = 2; bare!: string; })());
  tell("a member behind a list and a comma", new (class extends Model { [COMMA] = 1; y = 2; bare!: string; })());
  tell("a number member behind a list and a comma", new (class extends Model { [NUMBER] = 1; y = 2; bare!: string; })());
  tell("a member that a list picks", new (class extends Model { [PICKED] = 1; y = 2; bare!: string; })());
  tell("a member behind void", new (class extends Model { [VOIDED] = 1; y = 2; bare!: string; })());
  tell("a text that a sum picks is assigned", new (class extends Model { [TEXT_BY_A_SUM] = 1; y = 2; bare!: string; })());
  tell("a member that a sum picks", new (class extends Model { [BY_A_SUM] = 1; y = 2; bare!: string; })());
  tell("a member that a length picks", new (class extends Model { [BY_A_LENGTH] = 1; y = 2; bare!: string; })());
  tell("a member behind a length and &&", new (class extends Model { [AND] = 1; y = 2; bare!: string; })());
  tell("a member behind nothing and ||", new (class extends Model { [OR] = 1; y = 2; bare!: string; })());
}
export {};
