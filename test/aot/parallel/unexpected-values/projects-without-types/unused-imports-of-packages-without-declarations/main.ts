// An import that nobody uses is dropped. In a project without Bun's types a package without declarations stops no build where it is used, and none where it is dropped.
import unused from "untyped";
import * as all from "untyped-module";
import { one, two as other } from "untyped-names";
import type { Shape } from "untyped-types";
import { used, type Other } from "untyped-used";
import { second } from "./second.ts";
const shape: Shape = 5;
const value: Other = used(2);
console.log(shape, value, second);
