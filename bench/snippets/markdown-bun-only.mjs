import { bench, run } from "../runner.mjs";

const small = `# Hello World

This is a **bold** and *italic* paragraph with a [link](https://example.com).

- Item 1
- Item 2
- Item 3
`;

const medium = `# Project README

## Introduction

This is a medium-sized markdown document that includes **bold text**, *italic text*,
and \`inline code\`. It also has [links](https://example.com) and various formatting.

## Features

- Feature one with **bold**
- Feature two with *emphasis*
- Feature three with \`code\`
- Feature four with [a link](https://example.com)

## Code Example

\`\`\`javascript
function hello() {
  console.log("Hello, world!");
  return 42;
}
\`\`\`

## Table

| Name | Value | Description |
|------|-------|-------------|
| foo  | 1     | First item  |
| bar  | 2     | Second item |

> This is a blockquote with **bold** and *italic* text.
> It spans multiple lines and contains a [link](https://example.com).

---

1. First ordered item
   - Nested unordered
2. Second ordered item
`;

const large = medium.repeat(50);

bench(`html small (${small.length}b)`, () => Bun.markdown.html(small));
bench(`html medium (${medium.length}b)`, () => Bun.markdown.html(medium));
bench(`html large (${large.length}b)`, () => Bun.markdown.html(large));

await run();
