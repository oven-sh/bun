const note = text => (globalThis.order ??= []).push(text);
note("after");
await 0;
note("after-late");
