import list = require("./list.json");
import text = require("./text.json");
import count = require("./count.json");
import record = require("./record.json");

const first: string | number | null = list[0];
const shout: string = text.toUpperCase();
const next: number = count + 1;
let sum = 0;
for (const item of list) if (typeof item === "number") sum += item;
record.sizes.push(3);
console.log("SAID", first, list.length, shout, next, sum, record.name, record.sizes.join(), Object.keys(record).join());
console.log("SAID", Array.isArray(list), typeof text, typeof count);
