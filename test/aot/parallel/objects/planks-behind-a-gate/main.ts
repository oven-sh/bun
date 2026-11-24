import { shelf } from "./shed";
import * as yard from "./gate";
import Plank = yard.Wood.Plank;

const plank: Plank = { width: 3 };
console.log(plank.width, yard.count, yard.Wood.kind);
console.log(shelf());
