// A store tries to put the name of a field that most objects leave empty on Object.prototype, then a delete tries to take it away.
import { round, tried } from "../objects-with-a-field-left-empty";

function put(holder: any, value: unknown) {
  holder.late = value;
}
function take(holder: any) {
  delete holder.late;
}
const scratch = {};
round("before");
put(scratch, 1);
tried("store", () => put(Object.prototype, "text"));
round("behind the store");
take(scratch);
tried("delete", () => take(Object.prototype));
round("behind the delete");
