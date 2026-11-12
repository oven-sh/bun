import { shared } from "./shared.ts";
shared.count += 10;
postMessage(shared.count);
