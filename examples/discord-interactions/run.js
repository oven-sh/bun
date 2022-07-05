// polyfill v8 and node (TODO: fix in bun)
import './polyfill.js';

import path from 'node:path';
import { BunServer, BunSlashCreator } from './bun_shim/index.js';

const client = new BunSlashCreator({
  token: process.env.DISCORD_BOT_TOKEN,
  publicKey: process.env.DISCORD_PUBLIC_KEY,
  applicationID: process.env.DISCORD_APP_ID,
});

// client.on('debug', console.log);
client.on('error', console.error);

client.withServer(new BunServer());
await client.registerCommandsIn(path.join(__dirname, 'commands'));

client.syncCommands();
await client.server.listen(1337);

// client.server.stop(); // stop server