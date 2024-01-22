import { log } from "../src/console";
import { getSemver } from "../src/github";

log(await getSemver(process.argv[2]));
