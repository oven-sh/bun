import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.errors({ stack: false }),
    winston.format.json(),
  ),
  defaultMeta: { service: "user-service" },
  transports: [new winston.transports.Console()],
});
logger.info("hello %s number %d", "world", 5);
logger.debug("hidden");
logger.warn({ message: "object", code: 1 });
logger.error(new Error("boom"));
logger.child({ requestId: "r1" }).info("child");
const pretty = winston.createLogger({
  format: winston.format.combine(
    winston.format.label({ label: "L" }),
    winston.format.printf(({ level, message, label }) => `[${label}] ${level.toUpperCase()}: ${message}`),
  ),
  transports: [new winston.transports.Console({ level: "verbose" })],
});
pretty.verbose("seen");
pretty.silly("hidden");
console.log(logger.isInfoEnabled(), logger.isDebugEnabled(), Object.keys(winston.config.npm.levels).join());
