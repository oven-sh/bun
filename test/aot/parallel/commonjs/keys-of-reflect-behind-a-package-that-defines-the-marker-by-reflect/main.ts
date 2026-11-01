// The package defines the marker of an ES module by Reflect.defineProperty. The build makes no call. `bun run` has read the member off Reflect, which lists it from then on.
import { names } from "declared-1";
const listed: any = Object;
console.log("copied", names(Object.assign({}, listed)));
console.log("own keys", String(Reflect.ownKeys(listed)));
console.log("of Reflect", String((Object.assign({}, Reflect), Reflect.ownKeys(Reflect).map(String))));
