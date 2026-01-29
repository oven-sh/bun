import React from "react";
import { renderToString } from "react-dom/server";
import ReactMarkdown from "react-markdown";

const markdown = `# Project README

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

// Verify outputs are roughly the same
const bunHtml = renderToString(Bun.markdown.react(markdown));
const reactMarkdownHtml = renderToString(React.createElement(ReactMarkdown, { children: markdown }));

console.log("=== Bun.markdown.react output ===");
console.log(bunHtml.slice(0, 500));
console.log(`... (${bunHtml.length} chars total)\n`);

console.log("=== react-markdown output ===");
console.log(reactMarkdownHtml.slice(0, 500));
console.log(`... (${reactMarkdownHtml.length} chars total)\n`);

const server = Bun.serve({
  port: 0,
  routes: {
    "/bun-markdown": () => {
      return new Response(renderToString(Bun.markdown.react(markdown)), {
        headers: { "Content-Type": "text/html" },
      });
    },
    "/react-markdown": () => {
      return new Response(renderToString(React.createElement(ReactMarkdown, { children: markdown })), {
        headers: { "Content-Type": "text/html" },
      });
    },
  },
});

console.log(`Server listening on ${server.url}`);
console.log(`  ${server.url}bun-markdown`);
console.log(`  ${server.url}react-markdown`);
console.log();
console.log("Run:");
console.log(`  oha -c 20 -z 5s ${server.url}bun-markdown`);
console.log(`  oha -c 20 -z 5s ${server.url}react-markdown`);
