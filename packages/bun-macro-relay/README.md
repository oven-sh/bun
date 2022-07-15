# bun-macro-relay

This lets you use Facebook's [Relay](https://github.com/facebook/relay) framework (GraphQL) with bun.

Specifically, this implements the bun equivalent of [`babel-plugin-relay`](https://github.com/facebook/relay/tree/main/packages/babel-plugin-relay). It parses `graphql` queries, but does not compile/save them to your artifacts directory, you still need [`relay-compiler`](https://github.com/facebook/relay/tree/main/packages/relay-compiler) for that.

## Installation

```
npm install -D bun-macro-relay
```

## Usage

With three lines in your project's `bunfig.toml`, `react-relay` works automatically with bun.

Add this to your `bunfig.toml`:

```toml
[macros]
react-relay = {graphql = "bun-macro-relay"}
relay-runtime = {graphql = "bun-macro-relay"}
```

This tells bun to automatically pretend every import statement to `react-relay` with a `graphql` import came from `macro:bun-macro-relay/bun-macro-relay.tsx`.

Effectively, it applies this diff in-memory so you can use `bun-macro-relay` without making other changes to your code:

```js
// bun will remap this import:
import { graphql } from "react-relay";

// To this:
import { graphql } from "macro:bun-macro-relay/bun-macro-relay.tsx";
```

You can still use the other imports from `react-relay`. It only affects the `graphql` export from `react-relay`.

```js
// bun will remap this import:
import { graphql, useFragment } from "react-relay";

// To this:
import { graphql } from "macro:bun-macro-relay/bun-macro-relay.tsx";
import { useFragment } from "react-relay";
```

Ultimately, the `graphql` import should no longer appear in transpiled output:

```js
import { useFragment } from "react-relay";
```

If you'd rather not modify your project's `package.json`, you can do this instead:

```js
import { graphql } from "macro:bun-macro-relay";
```

## Configuration

For performance reasons, `bun-macro-relay` does not read `relay-config`. That means your Relay configuration will _not_ be honored.

Fortunately, the only configuration option relevant to `bun-macro-relay` is modifying the artifacts directory (the directory where `relay-compiler` saves compiled `.graphql` files).

You can still change that with `bun-macro-relay`.

### Changing the artifacts directory

Pass the `BUN_MACRO_RELAY_ARTIFACT_DIRECTORY` environment variable to bun:

```bash
BUN_MACRO_RELAY_ARTIFACT_DIRECTORY="__generated__" bun
```

You can also save it in `.env`, `.env.local`, or `.env.dev`. The path should be relative to the directory containing the project's package.json without a leading `.` or `./`. You can also pass it an absolute path.

## What does `bun-macro-relay` actually do?

1. Parses GraphQL (using the same `graphql` npm package as babel-plugin-relay)
2. Injects an import to the correct compiled GraphQL file in the Relay artifacts directory
3. Replaces the use of the `graphql` template literal with the `default` import from the compiled GraphQL file.

Here's an example.

Input:

```tsx
import { graphql, useLazyLoadQuery } from "react-relay";

const Tweet = () => {
  const data = useLazyLoadQuery(
    graphql`
      query TweetQuery {
        ...Tweet_tweet
      }
    `,
    {}
  );
  if (!data.tweet) return null;
  return <TweetComponent tweet={data.tweet} />;
};
```

Output:

```jsx
import TweetQuery from "../__generated__/TweetQuery.graphql.ts";
import { useLazyLoadQuery } from "react-relay";

const Tweet = () => {
  const data = useLazyLoadQuery(TweetQuery, {});
  if (!data.tweet) return null;
  return <TweetComponent tweet={data.tweet} />;
};
```

bun automatically transpiles JSX & TypeScript, but that's not relevant to this example.

### What does `bun-macro-relay` not do?

1. This first version doesn't hash the contents of the `graphql` query, so it won't detect when the GraphQL query is out of sync with the compiled `.graphql` file in development. However, if you're running Relay's CLI, bun's hot module reloading will automatically update. As long as you run Relay's CLI, it shouldn't matter. This will be fixed eventually (have to expose a native MD5 hashing function)
2. Compile GraphQL. You still need to use `relay-compiler` for that.
