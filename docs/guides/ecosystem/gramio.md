---
name: Create an Telegram bot using GramIO and Bun
---

[GramIO](https://gramio.dev) is a multi-runtime, extensible and very type-safe Telegram Bot API framework with great plugin system. Get started with `bun create`.

```sh
$ bun create gramio bot

√ Select linters/formatters: · Biome
√ Select ORM/Query Builder: · Drizzle
√ Select DataBase for Drizzle: · PostgreSQL
√ Select driver for PostgreSQL: · Postgres.JS
√ Select GramIO plugins: (Space to select, Enter to continue) · Auto-retry, Media-group, Media-cache, Session, I18n, Autoload, Prompt
√ Select others tools: (Space to select, Enter to continue) · Husky
√ Create an shared folder (for keyboards, callback-data)? · no / yes

✔ Template generation is complete!
✔ git init
✔ bun install
✔ echo "bun run lint:fix" > .husky/pre-commit
✔ bun x fluent2ts
✔ bun x @biomejs/biome init
✔ bun run lint:fix
```

---

As we can see, we can conveniently start new project with everything we need! Let's take a look at the `src/index.ts` file.

```ts#src/index.ts
import { autoRetry } from "@gramio/auto-retry";
import { autoload } from "@gramio/autoload";
import { i18n } from "@gramio/i18n";
import { mediaCache } from "@gramio/media-cache";
import { mediaGroup } from "@gramio/media-group";
import { prompt } from "@gramio/prompt";
import { session } from "@gramio/session";
import { Bot } from "gramio";
import type { TypedFluentBundle } from "./locales.types";

const bot = new Bot(process.env.TOKEN as string)
	.extend(mediaGroup())
	.extend(autoRetry())
	.extend(mediaCache())
	.extend(session())
	.extend(prompt())
	.extend(autoload())
	.extend(i18n<TypedFluentBundle>())
	.command("start", (context) => context.send("Hi!"))
	.onStart(({ info }) => console.log(`✨ Bot ${info.username} was started!`));

bot.start();
```

A lot of plugins, right? You can read about them [here](https://gramio.dev/plugins/).

Now let's start the development using the `bun dev` command, which runs the bot in `--watch` mode.

Let's send the document in response to a message from the user equal to «README»

```ts#src/index.ts
import { autoRetry } from "@gramio/auto-retry";
import { autoload } from "@gramio/autoload";
import { i18n } from "@gramio/i18n";
import { mediaCache } from "@gramio/media-cache";
import { mediaGroup } from "@gramio/media-group";
import { prompt } from "@gramio/prompt";
import { session } from "@gramio/session";
import { Bot } from "gramio";
import type { TypedFluentBundle } from "./locales.types";

const bot = new Bot(process.env.TOKEN as string)
	.extend(mediaGroup())
	.extend(autoRetry())
	.extend(mediaCache())
	.extend(session())
	.extend(prompt())
	.extend(autoload())
	.extend(i18n<TypedFluentBundle>())
	.hears("README", (context) => context.sendDocument(Bun.file("README.md")))
	.onStart(({ info }) => console.log(`✨ Bot ${info.username} was started!`));

bot.start();
```

---

Refer to the GramIO [documentation](https://gramio.dev/) for more information.
