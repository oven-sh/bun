import { join, extname } from 'path';
import { Creator } from 'slash-create';
import { readdirSync, lstatSync } from 'fs';
import { FetchRequestHandler } from './rest.js';
export { default as BunServer } from './server.js';

export class BunSlashCreator extends Creator {
  constructor(...args) {
    super(...args);
    this.requestHandler = new FetchRequestHandler(this);
  }

  async registerCommandsIn(commandPath, customExtensions = []) {
    const commands = [];
    const extensions = ['.js', '.ts', '.mjs', '.cjs', ...customExtensions];

    for (const path of find_files_with_extension(commandPath, extensions)) {
      try {
        commands.push(await import(path));
      } catch (error) {
        this.emit('error', new Error(`Failed to load command ${filePath}: ${e}`));
      }
    }

    return this.registerCommands(commands, true);
  }
}

function find_files_with_extension(path, extensions, names = []) {
  for (const name of readdirSync(path)) {
    const p = join(path, name);
    const stat =  lstatSync(p);

    if (extensions.includes(extname(name))) names.push(p);
    else if (stat.isDirectory()) find_files_with_extension(p, extensions, names);
  }

  return names;
}