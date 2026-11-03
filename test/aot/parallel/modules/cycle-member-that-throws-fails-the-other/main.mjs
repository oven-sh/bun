// A module of a synchronous cycle that throws fails the other member.
import { bodies } from "./log.mjs";
const caught = imported => imported.then(() => "fulfilled", error => error);
const first = await caught(import("./cycle-a.mjs"));
console.log(first.message);
console.log("other member", (await caught(import("./cycle-b.mjs"))) === first);
console.log("bodies", bodies.join());
