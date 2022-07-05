# /create with Bun runtime

A [slash-create](https://npm.im/slash-create) template, using [Bun runtime](https://bun.sh).

## Getting Started
### Cloning the repo
```sh
bun create discord-interactions interactions-bot
```

After that, make sure to install dependencies using bun or any other npm compatible package manager:
```sh
bun install
```

### Development
To run this locally, rename `.env.example` to `.env` and fill in the variables, then you can run `bun run.js` to start a local dev environment and use something like ngrok/cloudflare to tunnel it to a URL.