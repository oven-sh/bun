## Creating a Discord bot with Bun

Discord bots perform actions in response to _application commands_. There are 3 types of commands accessible in different interfaces: the chat input, a message's context menu (top-right menu or right-clicking in a message), and a user's context menu (right-clicking on a user).

To get started you can use the interactions template:

```bash
bun create discord-interactions my-interactions-bot
cd my-interactions-bot
```

If you don't have a Discord bot/application yet, you can create one [here (https://discord.com/developers/applications/me)](https://discord.com/developers/applications/me).

Invite bot to your server by visiting `https://discord.com/api/oauth2/authorize?client_id=<your_application_id>&scope=bot%20applications.commands`

Afterwards you will need to get your bot's token, public key, and application id from the application page and put them into `.env.example` file

Then you can run the http server that will handle your interactions:

```bash
$ bun install
$ mv .env.example .env
$ bun run.js # listening on port 1337
```

Discord does not accept an insecure HTTP server, so you will need to provide an SSL certificate or put the interactions server behind a secure reverse proxy. For development, you can use ngrok/cloudflare tunnel to expose local ports as secure URL.
