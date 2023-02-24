{% callout %}
**Note** — Bun provides a browser- and Node.js-compatible [console](https://developer.mozilla.org/en-US/docs/Web/API/console) global. This page only documents Bun-native APIs.
{% /callout %}

In Bun, the `console` object can be used as an `AsyncIterable` to sequentially read lines from `process.stdin`.

```ts
for await (const line of console) {
  console.log(line);
}
```

This is useful for implementing interactive programs, like the following addition calculator.

```ts#adder.ts
console.log(`Let's add some numbers!`);
console.write(`Count: 0\n> `);

let count = 0;
for await (const line of console) {
  count += Number(line);
  console.write(`Count: ${count}\n> `);
}
```

To run the file:

```bash
$ bun adder.ts
Let's add some numbers!
Count: 0
> 5
Count: 5
> 5
Count: 10
> 5
Count: 15
```
