import { held, renamed } from "./exports-the-constant.mjs";
say("in a file that imports the constants:", typeof held, held.two, Object.keys(renamed).join());
