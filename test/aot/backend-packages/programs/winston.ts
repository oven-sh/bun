import { Writable } from "node:stream";
import winston from "winston";

const lines: string[] = [];
const sink = new Writable({ write(chunk: Buffer, _encoding, done) { lines.push(chunk.toString().trimEnd()); done(); } });
const logger = winston.createLogger({
  level: "info", defaultMeta: { service: "smoke" },
  format: winston.format.combine(winston.format.splat(), winston.format.errors({ stack: false }), winston.format.json()),
  transports: [new winston.transports.Stream({ stream: sink })],
});
logger.info("hello %s", "world", { n: 1 });
logger.debug("not shown");
logger.child({ request: "r1" }).warn("careful");
logger.error(new Error("broken"));
const pretty = winston.createLogger({ format: winston.format.printf(info => `${info.level.toUpperCase()} ${info.message}`), transports: [new winston.transports.Stream({ stream: sink })] });
pretty.info("plain");
await new Promise(resolve => setTimeout(resolve, 50));
console.log(lines.join("\n"));
console.log("DONE");
