// caller.mjs runs ahead of reader.mjs, which imports it, and has it list the namespace object of data.json and read it under a computed key.
import "./reader.mjs";
