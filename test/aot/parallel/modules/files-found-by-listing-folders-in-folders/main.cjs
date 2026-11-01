// A program lists the folders in a folder beside it, lists each of them, and loads every file that it finds.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const commands = new Map();
const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);
for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) commands.set(command.data.name, command);
  }
}
for (const name of [...commands.keys()].sort()) console.log(name, commands.get(name).execute());

const eventsPath = path.join(__dirname, "events");
for (const file of fs.readdirSync(eventsPath).filter(file => file.endsWith(".js"))) {
  const event = require(path.join(eventsPath, file));
  console.log(event.name, event.once, event.execute());
}

(async () => {
  const root = path.join(__dirname, "plugins");
  for (const folder of fs.readdirSync(root).sort())
    for (const file of fs.readdirSync(path.join(root, folder)).sort())
      console.log((await import(pathToFileURL(path.join(root, folder, file)).href)).default);
  for (const file of fs.readdirSync(root, { recursive: true }).sort())
    if (file.endsWith(".mjs")) console.log((await import(path.join(root, file))).default);
})();
