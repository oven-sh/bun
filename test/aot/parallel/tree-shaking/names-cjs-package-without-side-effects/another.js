import { First, second } from "used-by-another";
console.log("another", new First().constructor.name, second);
