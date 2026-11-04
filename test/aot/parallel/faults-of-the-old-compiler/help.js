function bold(s) { return "*" + s[0] + "*"; }
function help(name) {
  return "Usage: " + name + " <command>\n" +
    `  ${bold`run`}   runs it\n` +
    `  ${bold`test`}  tests it\n`;
}
console.log(help(process.argv[2] ?? "app"));
