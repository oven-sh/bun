// The loader has asked for the files of a level when one of them runs, and has loaded none of them: require() parses the file itself, whether the import of it stands in front of the CommonJS file or behind.
// That is so where the texts are read as they are asked for, as these programs are run. Where a thread reads the text of the CommonJS file it comes in a later turn, the data is loaded by then, and the answer is the namespace object.
import inFront from "./in-front.json";
import "./early.cjs";
import behind from "./behind.json";
import "./below.mjs";
console.log("imported:", inFront.port, behind.port);
