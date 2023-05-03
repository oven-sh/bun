# `bun-plugin-server-components`

The official Bun plugin for **server components**.

## Installation

```sh
bun add bun-plugin-server-components -d
```

## Context

Server components are a new abstraction for building web applications. They look similar to standard React/JSX components, but render exclusively on the server. They differ from classic "client components" in a few ways:

1. They can be `async`.
2. Their implementation can run privileged code like database queries. Normally this would be unsafe, because the source code of client components are typically bundled and sent to the client, where they can be inspected and reverse-engineered. Server components are never sent to the client, so they can run privileged code safely.
3. They _cannot_ contain stateful hooks like `useState` or `useEffect`.

Server components require a deep integration with the bundler to work. To understand why, we need a bit of background on how server components work.

### How server components work

Imagine you have a server component that looks like this:

```tsx
// index.tsx
import { Component } from "./Component";
export default async function HomePage() {
  return (
    <div>
      <Component />
    </div>
  );
}
```

This file imports a client component called `Component`.

```ts
// ./Component.tsx
"use client";

export function Component() {
  return <div>Hello world</div>;
}
```

To run this component we need to generate two builds.

> Here the term "build" refers to a typical bundling step—the act of converting a set of entrypoints into a set of bundles.

1. The first is our "server component build". It contains all the code we need to render `HomePage` to a component tree. When an incoming `Request` comes in, we can use React's built-in tools to convert this tree into a "virtual DOM stream" that we can return as a `Response`.
2. The second is our "client build". It contains the bundled versions of all client components that were referenced by our server components.

The browser hits the server and gets back the "virtual DOM stream". The virtual DOM stream will contain references to client components, which will be loaded from the client bundle. React provides a built-in utility (`createFromFetch`)that accepts the VDOM stream, dynamically loads the necessary client components, and returns a renderable component.

```ts
import { createRoot } from "react-dom/client";
import { createFromFetch } from "react-server-dom-webpack/client.browser";

const stream = fetch("/", { headers: { Accept: "text/x-component" } });
const data = createFromFetch(stream);

const root = createRoot(document);
root.render(<App />);
```

### Server-side rendering

One potentially confusing aspect of server components is that they "return" virtual DOM. From the perspective of a server component, client components are black boxes.

If we want to do server-side rendering, we need to render our server component to VDOM, _then_ render the VDOM to plain HTML. These are two distinct steps. The second step requires a _third build_, we we'll call the "SSR build". Like the "client build", this build will bundle all the client components. Unlike the "client build", those bundles will be intended for consumption on the server; in bundler terms, the build's `"target"` will be`"bun"` (or perhaps `"node"`).

### Bundling server components

That's a high-level overview of how server components work. The important takeaway is that we need to generate totally separate bundles for server and client components.

But it's not just a simple matter of running two separate bundling scripts. The true "entrypoints" of our application are the server components. Over the course of bundling our server components, we will discover some files containing the `"use client"` directive; these files then become the entrypoints for our "client build", which will require a totally separate build configuration from the server build.

The goal of this plugin is to hide the complexty of this multi-stage build from the user.

## Usage

To use this plugin:

```ts
import ServerComponentsPlugin from "bun-plugin-server-components";

await Bun.build({
  entrypoints: ["./index.tsx"], // server component files
  plugins: [
    ServerComponentsPlugin({
      // plugin configuration
    }),
  ],
  // other configuration
});
```

The `"entrypoints"` you pass into `Bun.build()` should be your _server components_. Bun's bundler will automatically detect any files containing the `"use client"` directive, and will use those files as entrypoints for the "client build" and "SSR build". The bundler configuration for these builds can be provided `client` and `ssr` keys respectively.

```ts
import ServerComponentsPlugin from "bun-plugin-server-components";

await Bun.build({
  entrypoints: ["./index.tsx"], // server component files
  outdir: "./build",
  manifest: true,
  plugins: [ServerComponentsPlugin({
    client: {
      entrypoints: [], // optional - additional client entrypoints
      outdir: "./build/client", // default: inherits from the main build
      target: "browser",
      plugins: [/* */],
    }
    ssr: {
      entrypoints: [], // optional - additional SSR entrypoints
      outdir: "./build/client", // default: inherits from the main build
      target: "bun", // this is default
      plugins: [/* */],
    }
  })],
});
```

The result of `Bun.build()` will contain additional manifests for the SSR and client builds.

```ts
const result = await Bun.build({
  // config
  plugins: [
    ServerComponentsPlugin({
      /* config */
    }),
  ],
});

// standard manifest
// for the top-level (server components) build
result.manifest;

// manifest for client build
result.clientManifest;

// manifest for client build
result.ssrManifest;
```

Once the build is complete, you can use the manifests to implement your RSC server.
