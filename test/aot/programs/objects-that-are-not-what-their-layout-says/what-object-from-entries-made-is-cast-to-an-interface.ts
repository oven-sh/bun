interface Config { host: string; port: number }
const config = Object.fromEntries([["host", "localhost"], ["port", 80]]) as unknown as Config;
const other: Config = { host: "other", port: 1 };
function address(c: Config): string { return c.host + ":" + c.port; }
console.log(address(config), address(other));
config.port = 81;
console.log(address(config), JSON.stringify(config));
