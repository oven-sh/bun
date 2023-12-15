## Creating a Discord bot with Bun

Discord bots perform actions in response to _application commands_. There are three types of commands accessible in different interfaces: the chat input, a message's context menu (top-right menu or right-clicking in a message), and a user's context menu (right-clicking on a user).

To get started you can use the interactions template:

```bash
bun create discord-interactions my-interactions-bot
cd my-interactions-bot
```

If you don't have a Discord bot/application yet, you can create one [here (https://discord.com/developers/applications/me)](https://discord.com/developers/applications/me).

Invite bot to your server by visiting `https://discord.com/api/oauth2/authorize?client_id=<your_application_id>&scope=bot%20applications.commands`

Afterwards you will need to get your bot's token, public key, and application id from the application page and put them into `.env.example` file

Then run the HTTP server that will handle your interactions:

```bash
$ bun install
$ mv .env.example .env
$ bun run.js # listening on port 1337
```

Discord does not accept an insecure HTTP server, so you will need to provide an SSL certificate, or put the interactions server behind a secure reverse proxy. For development, you can use either Tunnelmole or ngrok/cloudflare tunnel to expose local ports as a secure URL.

#### Tunnelmole example
[Tunnelmole](https://tunnelmole.com) is an open source tunneling tool.

To install Tunnelmole for Linux, Mac or WSL copy and paste the following into a terminal
```bash
curl -O https://install.tunnelmole.com/LRfew/install && sudo bash install
```
*For Windows without WSL, [Download tmole.exe](https://tunnelmole.com/downloads/tmole.exe) and put it somewhere in your [PATH](https://www.wikihow.com/Change-the-PATH-Environment-Variable-on-Windows).*

Then run the following command, replacing `1337` with the port number your server is running on if it is different:

```bash
tmole 1337
```

You'll see output like
```
http://uh0hy3-ip-49-184-234-178.tunnelmole.net is forwarding to localhost:1313
https://uh0hy3-ip-49-184-234-178.tunnelmole.net is forwarding to localhost:1313
```

Be sure to configure discord to use the HTTPs URL. As previously mentioned, it does not accept insecure HTTP URLs.

#### Ngrok example
ngrok is a popular closed source tunnelling tool that you can also use for the same purpose.

Download and install it from [ngrok.com](https://ngrok.com/download)

Then run the following command, replacing `1337` with the port number your server is running on if it is different:
```bash
ngrok http 1337
```

Again, use the HTTPs URL and not the HTTP one.
