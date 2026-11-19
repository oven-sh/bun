import { shown } from "./marked.js";
const here = a=>a;
for (const it of [...shown, here]) console.log(JSON.stringify(String(it)));
