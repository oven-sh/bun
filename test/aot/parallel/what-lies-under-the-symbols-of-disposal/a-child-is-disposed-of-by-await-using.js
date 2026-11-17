// The child is Bun itself, asked for its version. Were it this program again, it would have been handed a word: it ends at once and starts nothing.
if (process.argv.length > 2) process.exit(0);
{
  await using child = Bun.spawn([process.execPath, "--version"], { stdout: "ignore", env: { BUN_BE_BUN: "1" } });
  console.log(typeof child.pid);
}
console.log("disposed of");
