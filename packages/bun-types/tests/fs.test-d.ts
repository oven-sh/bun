import * as tsd from "tsd";
import * as fs from "fs";
import { exists } from "fs/promises";

tsd.expectType<Promise<boolean>>(exists("/etc/passwd"));
tsd.expectType<Promise<boolean>>(fs.promises.exists("/etc/passwd"));
