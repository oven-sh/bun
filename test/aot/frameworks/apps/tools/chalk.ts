import chalk, { Chalk, supportsColor } from "chalk";

const colors = new Chalk({ level: 3 });
console.log(
  JSON.stringify([
    colors.red.bold("a"),
    colors.hex("#ff8800").bgBlue.underline("b"),
    colors.rgb(1, 2, 3)("c"),
    colors.green(`x ${colors.yellow("y")} z`),
    colors.ansi256(200)("d"),
    colors.inverse.dim("e\nf"),
  ]),
);
console.log(
  JSON.stringify([
    new Chalk({ level: 1 }).hex("#ff8800")("a"),
    new Chalk({ level: 0 }).red("b"),
    chalk.level,
    supportsColor,
    chalk.red("plain"),
    typeof colors.visible,
  ]),
);
