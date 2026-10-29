// Object.assign copies the name of a field that most objects leave empty onto prototype objects, out of a literal, out of parsed text and out of an object with more names than anybody follows.
import { Old, Point, round, tried } from "../objects-with-a-field-left-empty";

round("before");
Object.assign(Point.prototype, { late: "text" });
round("out of a literal");
Object.assign((Old as any).prototype, JSON.parse('{"late":7}'));
round("out of parsed text");
delete (Point.prototype as any).late;
delete (Old as any).prototype.late;
const many: Record<string, unknown> = {};
for (const name of ["early", "late", "never"]) many[name] = name;
Object.assign(Point.prototype, many);
round("out of an object filled in a loop");
delete (Point.prototype as any).late;
tried("onto Object.prototype", () => Object.assign(Object.prototype, many));
round("behind that");
