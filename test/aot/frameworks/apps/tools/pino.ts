import pino from "pino";

const logger = pino(
  {
    base: undefined,
    timestamp: false,
    level: "debug",
    redact: ["user.password"],
    serializers: { err: pino.stdSerializers.err },
  },
  pino.destination({ sync: true }),
);
logger.info("hello world");
logger.debug({ user: { name: "a", password: "secret" } }, "with %s and %d", "text", 5);
logger.trace("hidden");
const child = logger.child({ a: "property" });
child.warn({ list: [1, 2] }, "hello child!");
const error = new TypeError("boom");
error.stack = "TypeError: boom";
logger.error(error);
console.log(
  logger.level,
  logger.isLevelEnabled("trace"),
  logger.levels.values.fatal,
  pino.levels.labels[30],
  child.bindings().a,
);
