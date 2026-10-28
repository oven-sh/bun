// The importer stands on a cycle, the exporter on none. A function of the importer is called before the exporter has run.
import { describe } from "./reader.js";
console.log("main:", describe());
