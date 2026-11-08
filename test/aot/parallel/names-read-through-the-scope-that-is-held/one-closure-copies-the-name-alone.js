function make(skip) {
  let at = 0;
  const alone = () => skip;
  const both = () => (at++, skip);
  return { alone, both, at: () => at };
}
const made = make("k");
console.log(made.alone(), made.both(), made.both(), made.at());
