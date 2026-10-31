// A `--define` whose value is `module`, `exports`, `require`, `__filename`, `__dirname` or `arguments` is what the file or the function has under that name.
// Flags: --define MOD=module --define EXP=exports --define FILE=__filename --define DIR=__dirname --define ARGS=arguments --define REQ=require
exports.own = "an export of the file";
function count() {
  return ARGS.length;
}
console.log(
  MOD === module,
  EXP === exports,
  EXP.own,
  FILE === __filename,
  DIR === __dirname,
  count(1, 2, 3),
  typeof REQ,
);
