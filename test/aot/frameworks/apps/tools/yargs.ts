import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const parser = (argv: string[]) =>
  yargs(argv)
    .scriptName("app")
    .command(
      "serve [port]",
      "start the server",
      inner => inner.positional("port", { describe: "port to bind on", default: 5000, type: "number" }),
      parsed => console.log("serving", parsed.port, parsed.verbose),
    )
    .option("verbose", { alias: "v", type: "boolean", description: "Run with verbose logging" })
    .option("tag", { type: "array", string: true })
    .demandCommand(1)
    .strict()
    .exitProcess(false)
    .fail((message, error) => {
      throw error ?? new Error(message);
    });
const parsed = await parser(["serve", "80", "-v", "--tag", "a", "b"]).parse();
console.log(parsed.port, parsed.v, parsed.tag?.join(), parsed._.join(), hideBin(["bun", "x.ts", "-a"]).join());
for (const argv of [["serve", "--nope"], []])
  try {
    await parser(argv).parse();
  } catch (error) {
    console.log((error as Error).message);
  }
console.log(
  (await parser([]).getHelp())
    .split("\n")
    .filter(line => line.trim())
    .slice(0, 4)
    .join(" | "),
);
