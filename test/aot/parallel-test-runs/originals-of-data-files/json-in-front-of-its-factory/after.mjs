const note = text => (globalThis.order ??= []).push(text);
note("after");
