---
name: Use React and JSX
---

React just works with Bun. Bun supports `.jsx` and `.tsx` files out of the box. Bun's internal transpiler converts JSX syntax into vanilla JavaScript before execution.

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

Bun implements special logging for JSX to make debugging easier.

```bash
$ bun run react.tsx
<Component message="Hello world!" />
```

---

Refer to [Runtime > JSX](/docs/runtime/jsx) for complete documentation on configuring JSX.
