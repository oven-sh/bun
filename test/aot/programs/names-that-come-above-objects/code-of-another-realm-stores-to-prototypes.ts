// Code that runs in another realm is handed objects of this one and puts the name of a field that most of them leave empty above them.
import { runInNewContext } from "node:vm";
import { olds, options, points, round, tried } from "../objects-with-a-field-left-empty";

round("before");
runInNewContext("Object.getPrototypeOf(object).late = 'text'", { object: points[1] });
round("above an instance");
runInNewContext("delete Object.getPrototypeOf(object).late", { object: points[1] });
runInNewContext("Object.setPrototypeOf(object, { late: 7 })", { object: olds[1] });
runInNewContext("Object.setPrototypeOf(object, Object.prototype); Object.prototype.late = 'of the other realm'", { object: options[1] });
round("objects of the other realm above ours");
tried("the Object.prototype of this realm", () => runInNewContext("Object.getPrototypeOf(object).late = [1]", { object: options[2] }));
round("behind that");
