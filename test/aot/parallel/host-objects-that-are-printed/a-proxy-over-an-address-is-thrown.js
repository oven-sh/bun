// One question: built alone, it prints as plain Bun does.
// Exit code: 1
throw new Proxy(new URL("http://made.up/a"), {});
