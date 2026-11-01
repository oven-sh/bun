import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

const build = () => {
  const program = new Command();
  program
    .name("string-util")
    .description("CLI to some JavaScript string utilities")
    .version("0.8.0")
    .exitOverride()
    .configureOutput({
      writeOut: text => console.log("out:", text.trimEnd()),
      writeErr: text => console.log("err:", text.trimEnd()),
    });
  program
    .command("split")
    .description("Split a string into substrings")
    .argument("<string>", "string to split")
    .option("--first", "display just the first substring")
    .option("-s, --separator <char>", "separator character", ",")
    .addOption(
      new Option("-l, --limit <n>", "how many").argParser((value: string) => {
        const n = Number(value);
        if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
        return n;
      }),
    )
    .action((text: string, options: { first?: boolean; separator: string; limit?: number }) =>
      console.log(
        JSON.stringify(text.split(options.separator, options.first ? 1 : options.limit)),
        JSON.stringify(options),
      ),
    );
  return program;
};
for (const argv of [
  ["split", "--separator=/", "a/b/c"],
  ["split", "-l", "2", "a,b,c"],
  ["split", "--first", "a,b"],
  ["split"],
  ["split", "-l", "x", "a"],
  ["nothing"],
  ["--version"],
  ["help", "split"],
])
  try {
    build().parse(argv, { from: "user" });
  } catch (error) {
    console.log(error instanceof CommanderError, (error as CommanderError).code, (error as CommanderError).exitCode);
  }
