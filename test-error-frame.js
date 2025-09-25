// import "/tmp/e.ts";

console.log("test");

// Test error frames with different source contexts

// Function from an external module (should be dimmed)
 function def() {
  throw new Error("External error");
  // (await import("/tmp/e.ts")).abc();
}

// Simulate a stack trace with a function that has no source
eval(`
 function abc() {
  def();
}
 abc();
`);
