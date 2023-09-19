---
name: Use React and JSX
---

React just works with Bun. Bun supports `.jsx` and `.tsx` files out of the box.

Remember that JSX is just a special syntax for including HTML-like syntax in JavaScript files. Bun's internal transpiler converts JSX syntax into vanilla JavaScript before execution. React uses JSX syntax, as do other React alternatives like [Preact](https://preactjs.com/) and [Solid](https://www.solidjs.com/).

---

Bun supports _JSX_ out of the box, and it _assumes_ you're using React unless you [configure it otherwise](/docs/runtime/bunfig#jsx).

```tsx#react.tsx
function Component(props: {message: string}) {
  return (
    <body>
      <h1 style={{color: 'red'}}>{props.message}</h1>
    </body>
  );
}

console.log(<Component message="Hello world!" />);
```

---

Unless otherwise configured, Bun converts JSX into React components. So a line like this:

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

This code requires `react` to run, so make sure you you've installed React.

```bash
$ bun install react
```

---

Remember that JSX is just a special syntax for including HTML-like syntax in JavaScript files. React uses JSX syntax, as do other React alternatives like [Preact](https://preactjs.com/) and [Solid](https://www.solidjs.com/). Bun supports _JSX_ out of the box, and it _assumes_ you're using React unless you [configure it otherwise](/docs/runtime/bunfig#jsx).

---

Bun implements special logging for JSX components to make debugging easier.

```bash
$ bun run log-my-component.tsx
<Component message="Hello world!" />
```

---

As far as "official support" for React goes, that's it. React is a library like any other, and Bun can run that library. Bun is not a framework, so you should use a framework like [Vite](https://vitejs.dev/) to build an app with server-side rendering and hot reloading in the browser.

Refer to [Runtime > JSX](/docs/runtime/jsx) for complete documentation on configuring JSX.
