import { writeSync, openSync } from "fs";

const fd = openSync("repro.txt", "w");
writeSync(fd, "abc");
