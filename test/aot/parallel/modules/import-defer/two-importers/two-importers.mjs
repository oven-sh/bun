import defer * as a from "./a.mjs";
import { other, handedOn } from "./helper.mjs";
console.log("main begins", other === a, handedOn === a);
console.log(handedOn.value);
