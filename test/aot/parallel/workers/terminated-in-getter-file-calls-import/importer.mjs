import * as all from "node:process";
import "./file.cjs";
postMessage("the importer " + typeof all.custom);
