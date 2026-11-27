// Nothing here brings util.inspect into the executable, and the classes above have a native method of inspection.
for (const held of [new (class extends URL {})("http://example.com/"), (class extends URL {}).prototype, Object.create((class extends ReadableStream {}).prototype)]) {
  try {
    process.exitCode = held;
  } catch (error) {
    console.log(`${error.message}`);
  }
}
