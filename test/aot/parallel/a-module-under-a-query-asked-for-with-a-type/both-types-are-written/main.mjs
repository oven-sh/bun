import first from "./part.js" with { type: "text" };
import second from "./part.js?x" with { type: "text" };
console.log(typeof first, typeof second, first === second);
