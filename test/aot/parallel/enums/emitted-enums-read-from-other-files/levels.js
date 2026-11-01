import { look } from "./reader.js";
look("before");
export var Level;
(function (Level) {
  Level[(Level["Low"] = 0)] = "Low";
  look("during");
  Level[(Level["High"] = 10)] = "High";
})(Level || (Level = {}));
look("after");
export function levelInside() {
  return Level.Low + "/" + Level.High;
}
