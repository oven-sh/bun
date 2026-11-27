import { greet } from "./dep.cjs";

export const viaUser = () => "user " + greet();
