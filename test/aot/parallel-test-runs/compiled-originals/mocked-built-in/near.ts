import crypto, { randomInt } from "node:crypto";
import * as files from "fs";
import { basename } from "node:path";
export const top = typeof randomInt;
export const near = () => [typeof randomInt, randomInt(1, 9), typeof crypto.randomInt, files.existsSync("/"), basename("a/b")].join();
