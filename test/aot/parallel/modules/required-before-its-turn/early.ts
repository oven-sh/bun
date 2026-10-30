import { seen } from "./seen";

seen.push("early begins");
const required = require("./late") as typeof import("./late");
seen.push("early has " + required.late);
