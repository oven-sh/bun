try {
  console.log(String(Bun.inspect.call(() => 1, globalThis)).length > 100);
} catch (e) {
  console.log(e.name, e.message.slice(0, 140));
}

export {};
