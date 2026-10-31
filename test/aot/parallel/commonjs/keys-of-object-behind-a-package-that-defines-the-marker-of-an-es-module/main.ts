// The package begins as tsc writes it: Object.defineProperty(exports, "__esModule", { value: true }). The build takes the marker for a fact and makes no call.
// `bun run` makes the call and has read defineProperty off Object, which lists the member from then on.
import { names } from "./barrel";
const listed: any = Object;
console.log("copied", names(Object.assign({}, listed)));
console.log("own keys", String(Reflect.ownKeys(listed)));
console.log("of Reflect", String((Object.assign({}, Reflect), Reflect.ownKeys(Reflect).map(String))));
