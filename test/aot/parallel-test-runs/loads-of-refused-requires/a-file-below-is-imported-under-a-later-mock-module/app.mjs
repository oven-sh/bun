import { seen as below } from "./user.mjs";
console.log("app.mjs runs", below());
export const seen = () => "app " + below();
