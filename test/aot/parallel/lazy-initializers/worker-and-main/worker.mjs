import { read } from "./m.mjs";
read().title.text += " in the worker";
postMessage(read().title.text);
