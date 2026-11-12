import { read } from "./mocked.mjs";
export const second = () => "second " + read();
console.log("SAID second ran", read());
