export default function (results) {
  const sgr = c => "\x1b" + "[" + c + "m";
  const reset = sgr(0);
  const gray = s => sgr(2) + s + reset;
  const green = s => sgr(32) + s + reset;
  const cyan = s => sgr(36) + s + reset;

  for (const item of results) {
    if (item.messages.length === 0) {
      continue;
    }
    for (const jtem of item.messages) {
      console.log(
        `.${item.filePath.substring(process.cwd().length)}:${green(jtem.line)}:${cyan(jtem.column)}: ${gray(jtem.ruleId)} ${jtem.message}`,
      );
    }
  }
}
