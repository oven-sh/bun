---
name: Use React and JSX
---

React just works with Bun. Bun supports `.jsx` and `.tsx` files out of the box.

Remember that JSX is just a special syntax for including HTML-like syntax in JavaScript files. React uses JSX syntax, as do alternatives like [Preact](https://preactjs.com/) and [Solid](https://www.solidjs.com/). Bun's internal transpiler converts JSX syntax into vanilla JavaScript before execution.

---

Bun _assumes_ you're using React (unless you [configure it otherwise](https://bun.sh/docs/runtime/bunfig#jsx)) so a line like this:

```
const element = <h1>Hello, world!</h1>;
```

---

is internally converted into something like this:

```ts
// jsxDEV
import { jsx } from "react/jsx-dev-runtime";

const element = jsx("h1", { children: "Hello, world!" });
```

---

This code requires `react` to run, so make sure you've installed React.

```bash
$ bun install react
```

---

Bun implements special logging for JSX components to make debugging easier.

```bash
$ bun run log-my-component.tsx
<Component message="Hello world!" />
```

---

As far as "official support" for React goes, that's it. React is a library like any other, and Bun can run that library. Bun is not a framework, so you should use a framework like [Vite](https://vitejs.dev/) to build an app with server-side rendering and hot reloading in the browser.

Refer to [Runtime > JSX](https://bun.sh/docs/runtime/jsx) for complete documentation on configuring JSX.
