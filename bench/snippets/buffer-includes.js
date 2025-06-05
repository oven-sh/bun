const buf = Buffer.from(
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
);
const INTERVAL = 9_999_999;

const time = (name, fn) => {
  for (let i = 0; i < INTERVAL; i++) fn();

  console.time(name.padEnd(30));
  for (let i = 0; i < INTERVAL; i++) fn();
  console.timeEnd(name.padEnd(30));
};

console.log(`Run ${new Intl.NumberFormat().format(INTERVAL)} times with a warmup:`, "\n");

time("includes true", () => buf.includes("nisi"));
time("includes false", () => buf.includes("oopwo"));
