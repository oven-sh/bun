import { who } from "./dep.js";
import { viaUser } from "./user.js";
export const viaFresh = () => who + " and " + viaUser();
