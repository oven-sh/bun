try {
  JSON.parse("{ bad");
} catch (error) {
  console.log(error instanceof SyntaxError, typeof error.message);
}
