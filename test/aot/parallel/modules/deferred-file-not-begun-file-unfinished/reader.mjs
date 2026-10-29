import { Kind, list, text } from "./owner.mjs";
export var seen = [typeof text, text.length, list.length, Kind.size].join();
console.log("reader ends");
