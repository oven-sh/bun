// Reflect.construct makes objects of the class and of the constructor function for another new.target, whose `prototype` has the name of the field that most of them leave empty. A class below has an accessor of the name.
import { Old, olds, Point, points, round } from "../objects-with-a-field-left-empty";

function Other() {}
Other.prototype.late = "text";
class Below extends (Point as any) {
  get late(): any {
    return 7;
  }
  set late(value: any) {}
}
round("before");
points[1] = Reflect.construct(Point, [1], Other);
olds[1] = Reflect.construct(Old, [1], Other);
round("for a function");
points[3] = new (Below as any)(3);
round("a class below with an accessor");
