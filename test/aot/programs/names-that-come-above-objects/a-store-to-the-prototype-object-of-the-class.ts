// A store puts the name of a field that most objects leave empty on the prototype object of their class and of their constructor function, then a delete takes it away.
import { Old, Point, Point3, round } from "../objects-with-a-field-left-empty";

round("before");
(Point.prototype as any).late = "text";
(Old as any).prototype.late = 7;
round("on the prototype objects");
(Point3.prototype as any).late = { x: "x", y: [1] };
round("on the class below too");
delete (Point.prototype as any).late;
delete (Point3.prototype as any).late;
delete (Old as any).prototype.late;
round("deleted");
