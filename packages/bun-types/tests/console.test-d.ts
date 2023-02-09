import * as c1 from "node:console";
import * as c2 from "console";

c1.log();
c2.log();

for await (const line of c1) {
  console.log("Received:", line);
}

for await (const line of c2) {
  console.log("Received:", line);
}

for await (const line of console) {
  console.log("Received:", line);
}

export {};
