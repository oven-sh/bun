---
name: Create a Telegram bot using GramIO and Bun
---

[GramIO](https://gramio.dev) is a multi-runtime, extensible and very type-safe Telegram Bot API framework with a great plugin system. Create a production-ready Telegram bot with `bun create` in a few seconds.

```sh
$ bun create gramio@latest bot

√ Select type of project: · Bot

Choose your Telegram bot!

√ Select linters/formatters: · Biome
√ Select ORM/Query Builder: · Drizzle
√ Select DataBase for Drizzle: · PostgreSQL
√ Select driver for PostgreSQL: · Bun.sql
√ Select GramIO plugins: (Space to select, Enter to continue) · Scenes, I18n, Auto-retry, Media-group, Media-cache, Auto answer callback query, Autoload, Session, Prompt
√ Select type of i18n localization usage: · I18n-in-TS
√ Select languages: · en, ru
√ Select primary language: · en
√ Select type of storage for Scene plugin: · Redis
√ Do you want to use webhook adapter on production?: · Bun.serve
√ Select others tools: (Space to select, Enter to continue) · Jobify, Posthog
√ Create an empty Git repository? · yes
√ Do you want to use Locks to prevent race conditions? · yes
√ Create Dockerfile + docker.compose.yml? · yes
√ Create .vscode folder with VSCode extensions recommendations and settings? · yes

✔ Template generation is complete!

✔ git init
✔ bun install
✔ bun x @biomejs/biome init
✔ bun run lint:fix
```

---

As we can see, we can conveniently start a new project with everything we need! Let's take a look at the `src/index.ts` file.

```ts#src/index.ts
import { autoAnswerCallbackQuery } from "@gramio/auto-answer-callback-query";
import { autoRetry } from "@gramio/auto-retry";
import { autoload } from "@gramio/autoload";
import { mediaCache } from "@gramio/media-cache";
import { mediaGroup } from "@gramio/media-group";
import { prompt } from "@gramio/prompt";
import { scenes } from "@gramio/scenes";
import { session } from "@gramio/session";
import { redisStorage } from "@gramio/storage-redis";
import { Bot } from "gramio";
import { config } from "./config.ts";
import { greetingScene } from "./scenes/greeting.ts";
import { redis } from "./services/redis.ts";
import { i18n } from "./shared/locales/index.ts";

const storage = redisStorage(redis);

export const bot = new Bot(config.BOT_TOKEN)
	.extend(autoAnswerCallbackQuery())
	.extend(mediaGroup())
	.extend(autoRetry())
	.extend(mediaCache())
	.extend(session())
	.extend(
		scenes([greetingScene], {
			storage,
		}),
	)
	.extend(prompt())
	.extend(autoload())
	.derive("message", (context) => ({
		t: i18n.buildT(context.from?.languageCode ?? "en"),
	}))
	.onStart(({ info }) => console.log(`✨ Bot ${info.username} was started!`));

export type BotType = typeof bot;
```

A lot of plugins, right? You can read about them [here](https://gramio.dev/plugins/).

Now let's start the development using the `bun dev` command, which runs the bot in `--watch` mode.

Let's send the document in response to a message from the user equal to «README»

```ts#src/index.ts
import { autoAnswerCallbackQuery } from "@gramio/auto-answer-callback-query";
import { autoRetry } from "@gramio/auto-retry";
import { autoload } from "@gramio/autoload";
import { mediaCache } from "@gramio/media-cache";
import { mediaGroup } from "@gramio/media-group";
import { prompt } from "@gramio/prompt";
import { scenes } from "@gramio/scenes";
import { session } from "@gramio/session";
import { redisStorage } from "@gramio/storage-redis";
import { Bot } from "gramio";
import { config } from "./config.ts";
import { greetingScene } from "./scenes/greeting.ts";
import { redis } from "./services/redis.ts";
import { i18n } from "./shared/locales/index.ts";

const storage = redisStorage(redis);

export const bot = new Bot(config.BOT_TOKEN)
	.extend(autoAnswerCallbackQuery())
	.extend(mediaGroup())
	.extend(autoRetry())
	.extend(mediaCache())
	.extend(session())
	.extend(
		scenes([greetingScene], {
			storage,
		}),
	)
	.extend(prompt())
	.extend(autoload())
	.derive("message", (context) => ({
		t: i18n.buildT(context.from.languageCode),
	}))
	.hears("README", (context) => context.sendDocument(Bun.file("README.md")))
	.onStart(({ info }) => console.log(`✨ Bot ${info.username} was started!`));

export type BotType = typeof bot;
```

---

Refer to the GramIO [documentation](https://gramio.dev/) for more information.
