// The constructor function gets another object as its `prototype`, which has the name of the field that most of its objects leave empty.
import { Old, round } from "../objects-with-a-field-left-empty";

round("before");
(Old as any).prototype = { late: "text" };
round("replaced");
(Old as any).prototype = 5;
round("no object");
