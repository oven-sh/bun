const IS_WINDOWS = process.platform === "win32";
const SEP = IS_WINDOWS ? "\\" : "/";
const HOME = IS_WINDOWS ? "C:\\Users\\me" : "/home/me";
const configPath = [HOME, ".config", "app.json"].join(SEP);
console.log(configPath, IS_WINDOWS ? "exe" : "bin");
