// k.cjs requires a module that imports k.cjs. Beside them caller.mjs calls a function of reader.mjs, which imports it, and the function reads data.json ahead of the turn of that file.
import "./k.cjs";
import "./reader.mjs";
