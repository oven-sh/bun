// Build prints: 0 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import { read, readBeside } from "./lib/read.mjs";
try {
  console.log("read", JSON.stringify(String(readBeside(late))));
} catch (error) {
  console.log("caught", error.code ?? error.name);
}
function pick(which) {
  switch (which) {
    case 0:
      const inCase = import.meta.url;
    case 1:
      return readBeside(inCase);
  }
}
try {
  console.log("read", JSON.stringify(String(pick(1))));
} catch (error) {
  console.log("caught", error.code ?? error.name);
}
try {
  console.log("read", JSON.stringify(String(hoisted())));
} catch (error) {
  console.log("caught", error.code ?? error.name);
}
const arrow = () => readBeside(behind);
try {
  console.log("read", JSON.stringify(String(arrow())));
} catch (error) {
  console.log("caught", error.code ?? error.name);
}
const behind = import.meta.url;
function hoisted() {
  return read({ moduleUrl: behind });
}
for (let i = 0; i < 1; i++) {
  try {
    console.log("read", JSON.stringify(String(readBeside(inLoop))));
  } catch (error) {
    console.log("caught", error.code ?? error.name);
  }
  const inLoop = import.meta.url;
}
var late = import.meta.url;
