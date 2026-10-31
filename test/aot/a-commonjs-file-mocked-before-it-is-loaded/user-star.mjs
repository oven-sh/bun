import * as all from "./a.cjs";
export const seen = () => Reflect.ownKeys(all).map(String).join();
