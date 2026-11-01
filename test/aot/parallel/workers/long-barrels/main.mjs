import { spawn } from "./b1.mjs";
const w = spawn(new URL("./w.mjs", import.meta.url).href);
w.onmessage = e => {
  console.log(e.data);
  w.terminate();
};
w.onerror = e => {
  console.log("error", String(e.message).slice(0, 60));
};
