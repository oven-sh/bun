// Every plugin is in the program because this file imports it.
import * as one from "./one.ts";
import * as two from "./two.ts";
import * as folder from "./folder/index.ts";
import * as unused from "./unused.ts";
import three from "./three.cjs";

export const count = [one, two, folder, unused, three].length;
