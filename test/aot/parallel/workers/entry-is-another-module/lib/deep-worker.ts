import { bump, describe, Shared } from "./shared";
bump();
bump();
bump();
postMessage(describe(new Shared("deep")));
