// Two modules import each other. The one that is evaluated first holds the other's enum in a constant: the enum has not been made yet, so the constant holds undefined for good.
import { show } from "./levels";
console.log(show());
