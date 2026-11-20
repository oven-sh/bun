// Imports of built-in modules whose load shows nowhere, in every form of the statement, and no read of any name: no module of Bun runs.
// COUNT: operation:operationAOTRequireModule = 0
import os from "node:os";
import { domainToASCII, fileURLToPath } from "node:url";
import * as vm from "node:vm";
import dns, { lookup } from "node:dns";
import timers, * as allOfTimers from "node:timers";
import { runInNewContext as run } from "node:vm";
import "node:async_hooks";
import {} from "node:tty";
import { sep } from "node:path";
import querystring from "node:querystring";
import { channel } from "node:diagnostics_channel";
import { ReadableStream as Stream } from "node:stream/web";
console.log("no name of", 10, "modules was read");
