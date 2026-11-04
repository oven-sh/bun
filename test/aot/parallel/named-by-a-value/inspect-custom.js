import { inspect } from "node:util";
class Secret { [inspect.custom]() { return "hidden"; } }
console.log(inspect(new Secret()), new Secret());
