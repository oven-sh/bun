import { marked } from "marked";
import { remark } from "remark";
import remarkHtml from "remark-html";
import { bench, run, summary } from "../runner.mjs";

const remarkProcessor = remark().use(remarkHtml);

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

const result = hello();
\`\`\`

## Table

| Name | Value | Description |
|------|-------|-------------|
| foo  | 1     | First item  |
| bar  | 2     | Second item |
| baz  | 3     | Third item  |

## Blockquote

> This is a blockquote with **bold** and *italic* text.
> It spans multiple lines and contains a [link](https://example.com).

---

### Nested Lists

1. First ordered item
   - Nested unordered
   - Another nested
2. Second ordered item
   1. Nested ordered
   2. Another nested
3. Third ordered item

Some final paragraph with ~~strikethrough~~ text and more **formatting**.
`;

const large = medium.repeat(20);

summary(() => {
  if (typeof Bun !== "undefined" && Bun.markdown)
    bench(`small (${small.length} chars) - Bun.markdown`, () => {
      return Bun.markdown.html(small);
    });

  bench(`small (${small.length} chars) - marked`, () => {
    return marked(small);
  });

  bench(`small (${small.length} chars) - remark`, () => {
    return remarkProcessor.processSync(small).toString();
  });
});

summary(() => {
  if (typeof Bun !== "undefined" && Bun.markdown)
    bench(`medium (${medium.length} chars) - Bun.markdown`, () => {
      return Bun.markdown.html(medium);
    });

  bench(`medium (${medium.length} chars) - marked`, () => {
    return marked(medium);
  });

  bench(`medium (${medium.length} chars) - remark`, () => {
    return remarkProcessor.processSync(medium).toString();
  });
});

summary(() => {
  if (typeof Bun !== "undefined" && Bun.markdown)
    bench(`large (${large.length} chars) - Bun.markdown`, () => {
      return Bun.markdown.html(large);
    });

  bench(`large (${large.length} chars) - marked`, () => {
    return marked(large);
  });

  bench(`large (${large.length} chars) - remark`, () => {
    return remarkProcessor.processSync(large).toString();
  });
});

await run();
