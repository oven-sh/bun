// caller.mjs runs ahead of reader.mjs, which imports it, and has it add to a list of data.json. The list keeps what was added when the turn of the file comes.
import "./reader.mjs";
