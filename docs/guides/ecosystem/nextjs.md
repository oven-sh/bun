---
name: Build an app with Next.js and Bun
---

{% callout %}
Next.js currently relies on Node.js APIs that Bun does not yet implement. The guide below details how to set up a Next.js app using Bun, but it uses Node.js to run the Next.js dev server.
{% /callout %}

---

Initialize a Next.js app with `create-next-app`.

```sh
$ bunx create-next-app
```

Refer to [Runtime > JSX](/docs/runtime/jsx) for complete documentation on configuring JSX.
