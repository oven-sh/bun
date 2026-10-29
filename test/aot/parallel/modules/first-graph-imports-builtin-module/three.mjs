import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
tell("three begins", typeof EventEmitter, typeof promisify, typeof fileURLToPath);
