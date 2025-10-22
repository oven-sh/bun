---
name: Create a Discord bot
---

Discord.js works out of the box with Bun. Let's write a simple bot. First create a directory and initialize it with `bun init`.

```sh
$ mkdir my-bot
$ cd my-bot
$ bun init
```

---

Now install Discord.js.

```sh
$ bun add discord.js
```

---

Before we go further, we need to go to the [Discord developer portal](https://discord.com/developers/applications), login/signup, create a new _Application_, then create a new _Bot_ within that application. Follow the [official guide](https://discordjs.guide/preparations/setting-up-a-bot-application.html#creating-your-bot) for step-by-step instructions.

---

Once your bot is created, you'll be presented with its _private token_. You’ll need to store this securely in a .env.local file. Bun automatically reads this file and loads its contents into process.env.

```txt
DISCORD_TOKEN=your-bot-token-goes-here
```
Note: The example above uses a placeholder. Never commit your real token to version control.

Most .gitignore templates already include .env.local to prevent accidental leaks. If yours doesn’t, add the following line to your .gitignore:

```txt
.env.local
```
This ensures your sensitive credentials remain private and aren't pushed to GitHub or other remote repositories.


---

Be sure to add `.env.local` to your `.gitignore`! It is dangerous to check your bot's private key into version control.

```txt#.gitignore
node_modules
.env.local
```

---

Now let's actually write our bot in a new file called `bot.ts`.

```ts#bot.ts
// import discord.js
import {Client, Events, GatewayIntentBits} from 'discord.js';

// create a new Client instance
const client = new Client({intents: [GatewayIntentBits.Guilds]});

// listen for the client to be ready
client.once(Events.ClientReady, (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

// login with the token from .env.local
client.login(process.env.DISCORD_TOKEN);
```

---

Now we can run our bot with `bun run`. It may take a several seconds for the client to initialize the first time you run the file.

```sh
$ bun run bot.ts
Ready! Logged in as my-bot#1234
```

---

You're up and running with a bare-bones Discord.js bot! This is a basic guide to setting up your bot with Bun; we recommend the [official discord.js docs](https://discordjs.guide/) for complete information on the `discord.js` API.
